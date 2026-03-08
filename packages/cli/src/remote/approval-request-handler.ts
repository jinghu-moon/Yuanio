import { MessageType } from "@yuanio/shared";
import type {
  AgentStatus,
  ApprovalReqPayload,
  PermissionMode,
} from "@yuanio/shared";
import type { ApprovalRequest } from "../approval-server";
import type { TelegramSendMessageOptions } from "../telegram";
import {
  assessRisk,
  buildContext,
  buildDiffHighlights,
  buildFilePreview,
  buildRiskSummary,
  resolveApprovalDecision,
  type ApprovalLevel,
} from "./approval-utils";
import {
  evaluatePermissionRules,
  evaluateSandboxPolicy,
  type PermissionRuleSet,
  type SandboxPolicy,
} from "./permission-policy";

interface HookRunResultLike {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
}

export interface PendingApprovalMeta {
  tool: string;
  riskLevel: string;
  riskSummary?: string;
  diffHighlights?: string[];
  createdAt: number;
  telegramMessageId?: number;
}

export interface CreateApprovalRequestHandlerOptions {
  getExecutionMode: () => "act" | "plan";
  getPermissionMode: () => PermissionMode;
  getApprovalLevel: () => ApprovalLevel;
  getPermissionRules: () => PermissionRuleSet;
  getSandboxPolicy: () => SandboxPolicy;
  getSessionId: () => string;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  runHook: (
    event: "PreToolUse" | "PermissionRequest",
    payload: Record<string, unknown>,
  ) => Promise<HookRunResultLike | null>;
  emitStatusAndTurnState: (
    nextStatus: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
  emitApprovalRequested: (requestId: string) => void;
  pendingApprovals: Map<string, PendingApprovalMeta>;
  sendTelegram: (text: string) => Promise<void> | void;
  sendTelegramMessage: (options: TelegramSendMessageOptions) => Promise<number | null>;
}

export function createApprovalRequestHandler(options: CreateApprovalRequestHandlerOptions) {
  return async (req: ApprovalRequest) => {
    const files: string[] = [];
    const input = req.input as Record<string, unknown>;
    if (typeof input.file_path === "string") files.push(input.file_path);
    if (typeof input.command === "string") files.push(input.command.slice(0, 100));

    const riskLevel = assessRisk(req.tool, input);
    const sandboxDecision = evaluateSandboxPolicy(req.tool, input, options.getSandboxPolicy());
    if (!sandboxDecision.allowed) {
      console.log(`[approval] rejected by sandbox ${req.tool} (${sandboxDecision.reason || "unknown"})`);
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "PermissionRequest",
        event: "rejected",
        tool: req.tool,
        reason: sandboxDecision.reason || "sandbox blocked",
      }));
      req.resolve(false);
      return;
    }

    const executionMode = options.getExecutionMode();
    const permissionMode = options.getPermissionMode();

    const preToolHook = await options.runHook("PreToolUse", {
      event: "pre_tool_use",
      tool_name: req.tool,
      tool: req.tool,
      input,
      riskLevel,
      mode: executionMode,
      cwd: process.cwd(),
      sessionId: options.getSessionId(),
    });
    if (preToolHook?.blocked) {
      console.log(`[approval] rejected by hook PreToolUse ${req.tool} (${preToolHook.reason || "blocked"})`);
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "PreToolUse",
        event: "blocked",
        tool: req.tool,
        reason: preToolHook.reason || "blocked by PreToolUse hook",
      }));
      req.resolve(false);
      return;
    }

    if (executionMode === "plan") {
      console.log(`[approval] rejected by execution mode PLAN ${req.tool} (${riskLevel})`);
      req.resolve(false);
      return;
    }

    let decision = resolveApprovalDecision(permissionMode, riskLevel, req.tool, options.getApprovalLevel());
    const permissionDecision = evaluatePermissionRules(req.tool, input, options.getPermissionRules());
    if (permissionDecision === "allow") decision = "approve";
    if (permissionDecision === "deny") decision = "reject";
    if (permissionDecision === "ask") decision = "reject";

    if (decision === "approve") {
      console.log(`[approval] auto-approved mode=${permissionMode} ${req.tool} (${riskLevel})`);
      req.resolve(true);
      return;
    }

    if (decision === "reject" && permissionMode === "readonly") {
      console.log(`[approval] rejected by readonly ${req.tool} (${riskLevel})`);
      req.resolve(false);
      return;
    }

    const preview = await buildFilePreview(files);
    const diffHighlights = buildDiffHighlights(input);
    const riskSummary = buildRiskSummary(req.tool, riskLevel, input);
    let context = buildContext(req.tool, input);
    if (preToolHook && preToolHook.injectedContext.length > 0) {
      context += `\n\n[PreToolUse Hook]\n${preToolHook.injectedContext.slice(0, 2).join("\n")}`;
    }

    const permissionHook = await options.runHook("PermissionRequest", {
      event: "permission_request",
      tool_name: req.tool,
      tool: req.tool,
      input,
      riskLevel,
      mode: executionMode,
      permissionMode,
      cwd: process.cwd(),
      sessionId: options.getSessionId(),
    });
    if (permissionHook?.blocked) {
      console.log(`[approval] rejected by hook PermissionRequest ${req.tool} (${permissionHook.reason || "blocked"})`);
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "PermissionRequest",
        event: "blocked",
        tool: req.tool,
        reason: permissionHook.reason || "blocked by PermissionRequest hook",
      }));
      req.resolve(false);
      return;
    }

    if (permissionHook && permissionHook.injectedContext.length > 0) {
      context += `\n\n[Permission Hook]\n${permissionHook.injectedContext.slice(0, 2).join("\n")}`;
    }

    const payload: ApprovalReqPayload = {
      id: req.id,
      description: `工具 ${req.tool} 请求执行`,
      tool: req.tool,
      affectedFiles: files,
      riskLevel,
      riskSummary,
      diffHighlights,
      preview,
      context,
      permissionMode,
    };

    await options.sendEnvelope(MessageType.APPROVAL_REQ, JSON.stringify(payload));
    options.pendingApprovals.set(req.id, {
      tool: req.tool,
      riskLevel,
      riskSummary,
      diffHighlights,
      createdAt: Date.now(),
    });
    options.emitApprovalRequested(req.id);
    await options.emitStatusAndTurnState("waiting_approval", "approval_requested");
    void options.sendTelegram(`需要审批: ${req.tool} [${riskLevel}]`);

    const messageId = await options.sendTelegramMessage({
      text: [
        "需要审批",
        `ID: ${req.id}`,
        `工具: ${req.tool}`,
        `风险: ${riskLevel}`,
        riskSummary,
      ].join("\n"),
      replyMarkup: {
        inline_keyboard: [[
          { text: "批准", callback_data: `ia:approve:${req.id}` },
          { text: "拒绝", callback_data: `ia:reject:${req.id}` },
        ]],
      },
    });

    if (typeof messageId === "number") {
      const pending = options.pendingApprovals.get(req.id);
      if (pending) pending.telegramMessageId = messageId;
    }
  };
}

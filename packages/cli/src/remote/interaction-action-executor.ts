import { MessageType } from "@yuanio/shared";
import type {
  InteractionActionPayload,
  InteractionActionSource,
} from "@yuanio/shared";
import type { AgentStatus } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";
import { handleCancel } from "./cancel";
import { handleDiffAction } from "./diff-action";

export interface InteractionActionExecutorContext {
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  sendStatus: (s: AgentStatus, reason?: string) => Promise<void> | void;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  sendTelegram: (message: string) => void | Promise<void>;
  settleApproval: (id: string, approved: boolean, source: "app" | "telegram") => Promise<boolean>;
  pickPendingApprovalId: (specifiedId?: string) => string | null;
  dispatchPrompt: (
    prompt: string,
    source: InteractionActionSource,
  ) => Promise<void>;
}

function resolveApprovalSource(source?: InteractionActionSource): "app" | "telegram" {
  return source === "telegram" ? "telegram" : "app";
}

export interface InteractionActionExecutionResult {
  ok: boolean;
  message: string;
}

export async function executeInteractionAction(
  payload: InteractionActionPayload,
  ctx: InteractionActionExecutorContext,
): Promise<InteractionActionExecutionResult> {
  switch (payload.action) {
    case "continue": {
      const prompt = payload.prompt?.trim() || "continue";
      await ctx.dispatchPrompt(prompt, payload.source || "app");
      return { ok: true, message: `已执行继续: ${prompt}` };
    }
    case "retry": {
      const prompt = payload.prompt?.trim() || "continue";
      await ctx.dispatchPrompt(prompt, payload.source || "app");
      return { ok: true, message: `已执行重试: ${prompt}` };
    }
    case "stop": {
      await handleCancel(JSON.stringify({
        reason: payload.reason || "interaction_action_stop",
        taskId: payload.taskId,
      }), {
        runningAgents: ctx.runningAgents,
        sendStatus: ctx.sendStatus,
        sendEnvelope: ctx.sendEnvelope,
        sendTelegram: (msg) => {
          void ctx.sendTelegram(msg);
        },
      });
      return { ok: true, message: "已发送中止请求" };
    }
    case "approve":
    case "reject": {
      const approved = payload.action === "approve";
      const id = ctx.pickPendingApprovalId(payload.approvalId);
      if (!id) {
        return {
          ok: false,
          message: payload.approvalId
            ? `未找到待审批 ID: ${payload.approvalId}`
            : "当前没有待审批",
        };
      }
      const settled = await ctx.settleApproval(id, approved, resolveApprovalSource(payload.source));
      if (!settled) {
        return { ok: false, message: `审批处理失败: ${id}` };
      }
      return { ok: true, message: `${approved ? "已批准" : "已拒绝"}: ${id}` };
    }
    case "rollback": {
      const path = payload.path?.trim();
      if (!path) {
        return { ok: false, message: "rollback 缺少 path" };
      }
      await handleDiffAction({
        action: "rollback",
        path,
      }, ctx.sendEnvelope);
      return { ok: true, message: `已发起回滚: ${path}` };
    }
    default:
      return { ok: false, message: `不支持的交互动作: ${String(payload.action)}` };
  }
}

import { MessageType } from "@yuanio/shared";
import type { AgentStatus, ModelMode, PermissionMode } from "@yuanio/shared";
import { startApprovalServer, type OnApprovalRequest } from "../approval-server";
import type { AgentHandle, AgentType } from "../spawn";
import { startHeartbeat, type HeartbeatController } from "./heartbeat";

interface HookRunResultLike {
  injectedContext: string[];
}

export interface StartRuntimeStartupOptions {
  approvalRequestHandler: OnApprovalRequest;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  getStatus: () => AgentStatus;
  getDefaultAgent: () => AgentType;
  getPermissionMode: () => PermissionMode;
  getModelMode: () => ModelMode;
  getTurnStateVersion: () => number;
  getTurnStateReason: () => string;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  startTime: number;
  runSessionStartHook: (
    payload: Record<string, unknown>,
  ) => Promise<HookRunResultLike | null>;
  getSessionId: () => string;
  getCwd: () => string;
  getExecutionMode: () => "act" | "plan";
}

export function startRuntimeStartup(options: StartRuntimeStartupOptions): HeartbeatController {
  startApprovalServer(options.approvalRequestHandler).catch((e) => {
    console.error("[approval] 启动失败:", e);
  });

  const heartbeat = startHeartbeat({
    sendEnvelope: options.sendEnvelope,
    getStatus: options.getStatus,
    getDefaultAgent: options.getDefaultAgent,
    getPermissionMode: options.getPermissionMode,
    getModelMode: options.getModelMode,
    getTurnStateVersion: options.getTurnStateVersion,
    getTurnStateReason: options.getTurnStateReason,
    runningAgents: options.runningAgents,
    startTime: options.startTime,
  });

  void options.runSessionStartHook({
    event: "session_start",
    sessionId: options.getSessionId(),
    cwd: options.getCwd(),
    agent: options.getDefaultAgent(),
    mode: options.getExecutionMode(),
  }).then(async (result) => {
    if (!result || result.injectedContext.length === 0) return;
    await options.sendEnvelope(
      MessageType.HOOK_EVENT,
      JSON.stringify({
        hook: "SessionStart",
        event: "injected_context",
        tool: "session",
        detail: result.injectedContext.slice(0, 2).join("\n"),
      }),
    );
  }).catch(() => {});

  return heartbeat;
}

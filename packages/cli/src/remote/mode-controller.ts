import { MessageType } from "@yuanio/shared";
import type { AgentStatus, PermissionMode } from "@yuanio/shared";

export type ExecutionMode = "act" | "plan";

interface HookRunResultLike {
  injectedContext: string[];
}

export interface CreateModeControllerOptions {
  getExecutionMode: () => ExecutionMode;
  setExecutionModeState: (mode: ExecutionMode) => void;
  getPermissionMode: () => PermissionMode;
  setPermissionModeState: (mode: PermissionMode) => void;
  getCurrentStatus: () => AgentStatus;
  getSessionId: () => string;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  runConfigChangeHook: (payload: Record<string, unknown>) => Promise<HookRunResultLike | null>;
  emitStatusAndTurnState: (
    nextStatus: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
  heartbeatTick: () => Promise<void>;
  emitPermissionModeChanged: (mode: PermissionMode) => void;
}

export function createModeController(options: CreateModeControllerOptions) {
  const setExecutionMode = async (
    mode: ExecutionMode,
    source: "telegram" | "app" | "system" = "system",
  ): Promise<string> => {
    if (options.getExecutionMode() === mode) {
      return `执行模式保持不变: ${mode.toUpperCase()}`;
    }

    options.setExecutionModeState(mode);
    const hookResult = await options.runConfigChangeHook({
      event: "execution_mode",
      mode,
      source,
      cwd: process.cwd(),
      sessionId: options.getSessionId(),
    });

    if (hookResult && hookResult.injectedContext.length > 0) {
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "ConfigChange",
        event: "injected_context",
        tool: "execution_mode",
        detail: hookResult.injectedContext.slice(0, 2).join("\n"),
      }));
    }

    await options.emitStatusAndTurnState(options.getCurrentStatus(), `mode_${mode}`, true);
    await options.heartbeatTick();
    const detail = mode === "plan"
      ? "PLAN 模式：仅允许规划，写操作审批会被拒绝"
      : "ACT 模式：恢复正常执行";
    return `执行模式已切换为 ${mode.toUpperCase()}（来源: ${source}）\n${detail}`;
  };

  const setPermissionModeByRpc = async (
    mode: PermissionMode,
    source: "telegram" | "app" | "system" = "app",
  ): Promise<string> => {
    if (options.getPermissionMode() === mode) {
      return `权限模式保持不变: ${mode}`;
    }

    options.setPermissionModeState(mode);
    options.emitPermissionModeChanged(mode);
    await options.runConfigChangeHook({
      event: "permission_mode",
      mode,
      source,
      sessionId: options.getSessionId(),
      cwd: process.cwd(),
    });
    await options.emitStatusAndTurnState(options.getCurrentStatus(), `permission_${mode}`, true);
    await options.heartbeatTick();
    return `权限模式已切换为 ${mode}（来源: ${source}）`;
  };

  return {
    setExecutionMode,
    setPermissionModeByRpc,
  };
}

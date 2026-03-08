import type { ModelMode, PermissionMode, AgentStatus } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { LocalServer } from "../local-server";
import type { AgentHandle, AgentType } from "../spawn";
import type { ControlRouterContext } from "./control-router";

export interface CreateControlRouterContextProviderOptions {
  deviceId: string;
  relay: RelayClient;
  getLocalServer: () => LocalServer | null;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  processedPromptIds: Map<string, number>;
  sendEnvelope: ControlRouterContext["sendEnvelope"];
  emitStatusAndTurnState: (status: AgentStatus, reason?: string, force?: boolean) => Promise<void> | void;
  updateSession: ControlRouterContext["updateSession"];
  setDefaultAgent: (agent: AgentType) => void;
  getDefaultAgent: () => AgentType;
  getSessionId: () => string;
  getPermissionMode: () => PermissionMode;
  getModelMode: () => ModelMode;
  setModelMode: (mode: ModelMode) => void;
  setPermissionModeByRpc: ControlRouterContext["setPermissionModeByRpc"];
  getForegroundProbeSnapshot: ControlRouterContext["getForegroundProbeSnapshot"];
  refreshProjectScopedConfig: () => void;
  runConfigChangeHook: (ctx: Record<string, unknown>) => Promise<unknown>;
  emitModelModeChanged: (mode: ModelMode) => void;
  heartbeatTick: () => Promise<void>;
}

export function createControlRouterContextProvider(options: CreateControlRouterContextProviderOptions) {
  return (): ControlRouterContext => ({
    deviceId: options.deviceId,
    relay: options.relay,
    localServer: options.getLocalServer(),
    runningAgents: options.runningAgents,
    processedPromptIds: options.processedPromptIds,
    sendEnvelope: options.sendEnvelope,
    sendStatus: (status, reason, force) => options.emitStatusAndTurnState(status, reason, force),
    updateSession: options.updateSession,
    setDefaultAgent: options.setDefaultAgent,
    getDefaultAgent: options.getDefaultAgent,
    getSessionId: options.getSessionId,
    getPermissionMode: options.getPermissionMode,
    getModelMode: options.getModelMode,
    setModelMode: options.setModelMode,
    setPermissionModeByRpc: options.setPermissionModeByRpc,
    getForegroundProbeSnapshot: options.getForegroundProbeSnapshot,
    refreshProjectScopedConfig: options.refreshProjectScopedConfig,
    runConfigChangeHook: async (ctx) => {
      await options.runConfigChangeHook(ctx);
    },
    emitModelModeChanged: options.emitModelModeChanged,
    heartbeatTick: options.heartbeatTick,
  });
}

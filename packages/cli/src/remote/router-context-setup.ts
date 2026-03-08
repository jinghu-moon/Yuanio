import type { AgentStatus, ModelMode, PermissionMode } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { LocalServer } from "../local-server";
import type { AgentHandle, AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";
import type { ControlRouterContext } from "./control-router";
import { createControlRouterContextProvider } from "./control-context-provider";
import type { NonPromptRouterContext } from "./non-prompt-router";
import { createNonPromptRouterContextProvider } from "./non-prompt-context-provider";
import type { PtyController } from "./pty";

export interface CreateRouterContextSetupOptions {
  deviceId: string;
  relay: RelayClient;
  getLocalServer: () => LocalServer | null;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  processedPromptIds: Map<string, number>;
  sendEnvelope: ControlRouterContext["sendEnvelope"];
  emitStatusAndTurnState: (
    status: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
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
  consumeQueueItem: (item: QueueItem) => void;
  maxParallel?: number;
  sendTelegram: (message: string) => void;
  ptyController: PtyController;
  settleApproval: NonPromptRouterContext["settleApproval"];
  pickPendingApprovalId: NonPromptRouterContext["pickPendingApprovalId"];
  dispatchInteractionPrompt: NonPromptRouterContext["dispatchInteractionPrompt"];
}

export function createRouterContextSetup(options: CreateRouterContextSetupOptions) {
  const buildControlContext = createControlRouterContextProvider({
    deviceId: options.deviceId,
    relay: options.relay,
    getLocalServer: options.getLocalServer,
    runningAgents: options.runningAgents,
    processedPromptIds: options.processedPromptIds,
    sendEnvelope: options.sendEnvelope,
    emitStatusAndTurnState: options.emitStatusAndTurnState,
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
    runConfigChangeHook: options.runConfigChangeHook,
    emitModelModeChanged: options.emitModelModeChanged,
    heartbeatTick: options.heartbeatTick,
  });

  const buildNonPromptContext = createNonPromptRouterContextProvider({
    sendEnvelope: options.sendEnvelope,
    runningAgents: options.runningAgents,
    consumeQueueItem: options.consumeQueueItem,
    maxParallel: options.maxParallel,
    emitStatusAndTurnState: (status, reason) => options.emitStatusAndTurnState(status, reason),
    sendTelegram: options.sendTelegram,
    ptyController: options.ptyController,
    settleApproval: options.settleApproval,
    pickPendingApprovalId: options.pickPendingApprovalId,
    dispatchInteractionPrompt: options.dispatchInteractionPrompt,
  });

  return {
    buildControlContext,
    buildNonPromptContext,
  };
}

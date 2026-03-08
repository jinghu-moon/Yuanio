import type { AgentStatus, MessageType } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";
import { createTelegramTaskActions } from "./telegram-task-actions";
import type { DispatchPromptParams } from "./prompt-dispatch-runtime";
import type { CreateTelegramWiringOptions } from "./telegram-wiring";

interface ForegroundProbeSnapshotLike {
  status: string;
  cwd: string;
  runningTasks?: number;
  pendingApprovals?: number;
  turnStateVersion?: number;
  turnStateReason?: string;
}

type ExecutionMode = "act" | "plan";

export interface CreateTelegramWiringBuilderOptions {
  deviceId: string;
  getSessionId: () => string;
  dispatchPrompt: (params: DispatchPromptParams) => Promise<void>;
  dispatchRpcForTelegram: CreateTelegramWiringOptions["dispatchRpcForTelegram"];
  renderTaskOutputText: CreateTelegramWiringOptions["renderTaskOutputText"];
  clampTextForTelegram: CreateTelegramWiringOptions["clampTextForTelegram"];
  contextWindowSize: number;
  getRunningAgentsSize: () => number;
  getQueueSize: () => number;
  getCompactSummariesCount: () => number;
  getForegroundProbeSnapshot: () => ForegroundProbeSnapshotLike;
  executeInteractionAction: CreateTelegramWiringOptions["executeInteractionAction"];
  settleApproval: CreateTelegramWiringOptions["settleApproval"];
  listRecentResumeSessions: CreateTelegramWiringOptions["listRecentResumeSessions"];
  validateForwardCommand: CreateTelegramWiringOptions["validateForwardCommand"];
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  emitStatusAndTurnState: (s: AgentStatus, reason?: string) => Promise<void> | void;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  sendTelegram: (message: string) => void;
  clearQueue: () => number;
  buildLoopPrompt: (prompt: string) => string;
  loopMaxIterations: number;
  getStatus: () => AgentStatus;
  getExecutionMode: () => ExecutionMode;
  autoTestGateEnabled: boolean;
  autoTestGateCmd: string;
  getPendingApprovalsSize: () => number;
  getCwd: () => string;
  getTurnStateVersion: () => number;
  getTurnStateReason: () => string;
  setExecutionMode: (
    mode: ExecutionMode,
    source: "telegram" | "app" | "system",
  ) => Promise<string>;
  formatRunningTasksPanel: () => string;
  listTaskHistoryText: (args: string[]) => Promise<string>;
  listCheckpointText: () => string;
  restoreCheckpointById: (checkpointId: string) => Promise<string>;
  approvalsListToPageIds: (page: number) => string[];
  buildApprovalsPageResult: CreateTelegramWiringOptions["buildApprovalsPageResult"];
}

export function createTelegramWiringOptions(
  options: CreateTelegramWiringBuilderOptions,
): CreateTelegramWiringOptions {
  return {
    promptDispatch: {
      deviceId: options.deviceId,
      getSessionId: options.getSessionId,
      dispatchPrompt: options.dispatchPrompt,
    },
    dispatchRpcForTelegram: options.dispatchRpcForTelegram,
    renderTaskOutputText: options.renderTaskOutputText,
    clampTextForTelegram: options.clampTextForTelegram,
    contextWindowSize: options.contextWindowSize,
    getRunningAgentsSize: options.getRunningAgentsSize,
    getQueueSize: options.getQueueSize,
    getCompactSummariesCount: options.getCompactSummariesCount,
    getForegroundProbeSnapshot: options.getForegroundProbeSnapshot,
    executeInteractionAction: options.executeInteractionAction,
    settleApproval: options.settleApproval,
    listRecentResumeSessions: options.listRecentResumeSessions,
    validateForwardCommand: options.validateForwardCommand,
    ...createTelegramTaskActions({
      runningAgents: options.runningAgents,
      emitStatus: (s, reasonText) => options.emitStatusAndTurnState(s, reasonText),
      sendEnvelope: options.sendEnvelope,
      sendTelegram: options.sendTelegram,
      clearQueue: options.clearQueue,
    }),
    buildLoopPrompt: options.buildLoopPrompt,
    loopMaxIterations: options.loopMaxIterations,
    getStatusSnapshot: () => ({
      status: options.getStatus(),
      executionMode: options.getExecutionMode(),
      autoTestGateEnabled: options.autoTestGateEnabled,
      autoTestGateCmd: options.autoTestGateCmd,
      runningTasks: options.getRunningAgentsSize(),
      pendingApprovals: options.getPendingApprovalsSize(),
      cwd: options.getCwd(),
      turnStateVersion: options.getTurnStateVersion(),
      turnStateReason: options.getTurnStateReason(),
      sessionId: options.getSessionId(),
    }),
    setExecutionMode: options.setExecutionMode,
    formatRunningTasksPanel: options.formatRunningTasksPanel,
    listTaskHistoryText: options.listTaskHistoryText,
    listCheckpointText: options.listCheckpointText,
    restoreCheckpointById: options.restoreCheckpointById,
    approvalsListToPageIds: options.approvalsListToPageIds,
    buildApprovalsPageResult: options.buildApprovalsPageResult,
  };
}

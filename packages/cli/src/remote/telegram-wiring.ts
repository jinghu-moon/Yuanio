import type { TelegramApprovalsPageResult } from "../telegram-webhook";
import { createTelegramBaseHandlers } from "./telegram-base-handlers";
import type { TelegramInteractionContext } from "./telegram-interaction";
import { createTelegramPromptDispatcher } from "./telegram-prompt-dispatch";
import type { TelegramPromptDispatchContext } from "./telegram-prompt-dispatch";
import { createTelegramRpcHandlers } from "./telegram-rpc-handlers";
import type { DispatchRpcForTelegram } from "./telegram-rpc-handlers";
import { createTelegramWebhookHandlers } from "./telegram-webhook-handlers";

type ExecutionMode = "act" | "plan";

interface ForegroundProbeSnapshotLike {
  status: string;
  cwd: string;
  runningTasks?: number;
  pendingApprovals?: number;
  turnStateVersion?: number;
  turnStateReason?: string;
}

export interface CreateTelegramWiringOptions {
  promptDispatch: TelegramPromptDispatchContext;
  dispatchRpcForTelegram: DispatchRpcForTelegram;
  renderTaskOutputText: (value: unknown) => string;
  clampTextForTelegram: (value: string, maxChars?: number) => string;
  contextWindowSize: number;
  getRunningAgentsSize: () => number;
  getQueueSize: () => number;
  getCompactSummariesCount: () => number;
  getForegroundProbeSnapshot: () => ForegroundProbeSnapshotLike;
  executeInteractionAction: TelegramInteractionContext["executeInteractionAction"];
  settleApproval: (id: string, approved: boolean, source: "app" | "telegram") => Promise<boolean>;
  listRecentResumeSessions: TelegramInteractionContext["listRecentResumeSessions"];
  validateForwardCommand: TelegramInteractionContext["validateForwardCommand"];
  stopTasks: (reason: string) => Promise<void>;
  clearTasksAndQueue: (reason: string) => Promise<{ runningCount: number; clearedQueue: number }>;
  buildLoopPrompt: (prompt: string) => string;
  loopMaxIterations: number;
  getStatusSnapshot: () => {
    status: string;
    executionMode: ExecutionMode;
    autoTestGateEnabled: boolean;
    autoTestGateCmd: string;
    runningTasks: number;
    pendingApprovals: number;
    cwd: string;
    turnStateVersion: number;
    turnStateReason: string;
    sessionId: string;
  };
  setExecutionMode: (
    mode: ExecutionMode,
    source: "telegram" | "app" | "system",
  ) => Promise<string>;
  formatRunningTasksPanel: () => string;
  listTaskHistoryText: (args: string[]) => Promise<string>;
  listCheckpointText: () => string;
  restoreCheckpointById: (checkpointId: string) => Promise<string>;
  approvalsListToPageIds: (page: number) => string[];
  buildApprovalsPageResult: (page: number, banner?: string) => TelegramApprovalsPageResult;
}

export function createTelegramWiring(options: CreateTelegramWiringOptions) {
  const promptDispatcher = createTelegramPromptDispatcher(options.promptDispatch);
  const rpcHandlers = createTelegramRpcHandlers({
    dispatchRpcForTelegram: options.dispatchRpcForTelegram,
    renderTaskOutputText: options.renderTaskOutputText,
    clampTextForTelegram: options.clampTextForTelegram,
    contextWindowSize: options.contextWindowSize,
    getRunningAgentsSize: options.getRunningAgentsSize,
    getQueueSize: options.getQueueSize,
    getCompactSummariesCount: options.getCompactSummariesCount,
    getForegroundProbeSnapshot: options.getForegroundProbeSnapshot,
  });
  const interactionContext: TelegramInteractionContext = {
    executeInteractionAction: options.executeInteractionAction,
    listRecentResumeSessions: options.listRecentResumeSessions,
    sendResumePrompt: (resumeSessionId: string) => promptDispatcher.sendResume(resumeSessionId),
    validateForwardCommand: options.validateForwardCommand,
    sendForwardPrompt: (rawText: string) => promptDispatcher.sendForwardPrompt(rawText),
    sendInteractiveInput: (input: string) => promptDispatcher.sendInteractiveInput(input),
  };
  const baseHandlers = createTelegramBaseHandlers({
    sendPrompt: (prompt) => promptDispatcher.sendPrompt(prompt),
    sendContinue: () => promptDispatcher.sendContinue(),
    stopTasks: options.stopTasks,
    clearTasksAndQueue: options.clearTasksAndQueue,
    buildLoopPrompt: options.buildLoopPrompt,
    loopMaxIterations: options.loopMaxIterations,
    getStatusSnapshot: options.getStatusSnapshot,
    setExecutionMode: options.setExecutionMode,
    formatRunningTasksPanel: options.formatRunningTasksPanel,
    listTaskHistoryText: options.listTaskHistoryText,
    listCheckpointText: options.listCheckpointText,
    restoreCheckpointById: options.restoreCheckpointById,
  });
  const webhookHandlers = createTelegramWebhookHandlers({
    baseHandlers,
    rpcHandlers,
    interactionContext,
    approvalsListToPageIds: options.approvalsListToPageIds,
    buildApprovalsPageResult: options.buildApprovalsPageResult,
    settleApproval: options.settleApproval,
    dispatchRpcForTelegram: options.dispatchRpcForTelegram,
  });
  return { webhookHandlers };
}

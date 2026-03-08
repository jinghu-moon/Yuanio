import type { AgentStatus, IngressPromptSource, UsageInfo } from "@yuanio/shared";
import type { AgentType } from "../spawn";
import { collectTaskSummary } from "./task-summary";
import {
  createPromptDispatchSetup,
  type CreatePromptDispatchSetupOptions,
} from "./prompt-dispatch-setup";
import { createTaskFinishedHandler } from "./task-finished-handler";

interface TaskRegistryLike {
  start: (input: {
    taskId: string;
    promptId: string;
    prompt: string;
    agent: AgentType;
    source?: IngressPromptSource;
  }) => unknown;
  attachStopper: (taskId: string, stopper: () => void) => void;
  appendOutput: (taskId: string, text: string) => void;
  get: (taskId: string) => { status: string } | null;
  finish: (taskId: string, status: "completed" | "error", error?: string) => void;
}

interface CheckpointStoreLike {
  add: (input: {
    taskId: string;
    promptId?: string;
    agent: string;
    prompt: string;
    source?: IngressPromptSource;
    cwd: string;
    files: string[];
  }) => { id: string };
}

interface HookRunResultLike {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
}

export interface CreatePromptRuntimeSetupOptions<TContext> extends Omit<
  CreatePromptDispatchSetupOptions<TContext>,
  "onUsage" | "collectTaskSummary" | "onTaskStarted" | "onTaskOutput" | "onTaskFinished"
> {
  taskRegistry: TaskRegistryLike;
  checkpointStore: CheckpointStoreLike;
  autoTestGateEnabled: boolean;
  autoTestGateCmd: string;
  autoTestGateTimeoutMs: number;
  emitStatusAndTurnState: (
    status: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
  runTaskCompletedHook: (payload: Record<string, unknown>) => Promise<HookRunResultLike | null>;
  runToolResultHook: (
    event: "PostToolUse" | "PostToolUseFailure",
    payload: Record<string, unknown>,
  ) => Promise<HookRunResultLike | null>;
  cumulativeUsage: Required<UsageInfo>;
}

export function createPromptRuntimeSetup<TContext>(
  options: CreatePromptRuntimeSetupOptions<TContext>,
) {
  const handleTaskFinished = createTaskFinishedHandler({
    taskRegistry: options.taskRegistry,
    runTaskCompletedHook: options.runTaskCompletedHook,
    sendEnvelope: options.sendEnvelope,
    checkpointStore: options.checkpointStore,
    autoTestGateEnabled: options.autoTestGateEnabled,
    autoTestGateCmd: options.autoTestGateCmd,
    autoTestGateTimeoutMs: options.autoTestGateTimeoutMs,
    emitStatusAndTurnState: options.emitStatusAndTurnState,
    sendTelegram: options.sendTelegram,
  });

  return createPromptDispatchSetup({
    relay: options.relay,
    deviceId: options.deviceId,
    peerDeviceId: options.peerDeviceId,
    getSessionId: options.getSessionId,
    sendEnvelope: options.sendEnvelope,
    sendTelegram: options.sendTelegram,
    sendTelegramMessage: options.sendTelegramMessage,
    runningAgents: options.runningAgents,
    maxParallel: options.maxParallel,
    processedPromptIds: options.processedPromptIds,
    maxProcessedPrompts: options.maxProcessedPrompts,
    getDefaultAgent: options.getDefaultAgent,
    setStatus: options.setStatus,
    taskUsageMap: options.taskUsageMap,
    taskStartMap: options.taskStartMap,
    nextTaskId: options.nextTaskId,
    getApprovalPort: options.getApprovalPort,
    onUsage: (ev) => {
      options.cumulativeUsage.inputTokens += ev.inputTokens || 0;
      options.cumulativeUsage.outputTokens += ev.outputTokens || 0;
      options.cumulativeUsage.cacheCreationTokens += ev.cacheCreationTokens || 0;
      options.cumulativeUsage.cacheReadTokens += ev.cacheReadTokens || 0;
    },
    runToolResultHook: options.runToolResultHook,
    collectTaskSummary: (taskId) => collectTaskSummary(taskId, options.taskStartMap, options.taskUsageMap),
    onTaskStarted: async (info) => {
      options.taskRegistry.start({
        taskId: info.taskId,
        promptId: info.promptId,
        prompt: info.prompt,
        agent: info.agent,
        source: info.source,
      });
      options.taskRegistry.attachStopper(info.taskId, info.stop);
    },
    onTaskOutput: async (taskId, line) => {
      options.taskRegistry.appendOutput(taskId, line);
    },
    onTaskFinished: handleTaskFinished,
    recordProcessLine: options.recordProcessLine,
    preprocessPromptForExecution: options.preprocessPromptForExecution,
    getCwd: options.getCwd,
    getContextUsage: options.getContextUsage,
    compactSummaries: options.compactSummaries,
  });
}

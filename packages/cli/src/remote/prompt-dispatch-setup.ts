import { processQueue, enqueuePrompt as enqueuePromptTask } from "./queue";
import { createPromptDispatchRuntime, type CreatePromptDispatchRuntimeOptions } from "./prompt-dispatch-runtime";
import { createPromptDispatchGateway, type CreatePromptDispatchGatewayOptions } from "./prompt-dispatch-gateway";
import { createQueuePromptConsumer } from "./queue-prompt-consumer";
import { createPromptActions, type CreatePromptActionsOptions } from "./prompt-actions";
import type { AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";

export interface CreatePromptDispatchSetupOptions<TContext> {
  relay: CreatePromptDispatchRuntimeOptions["relay"];
  deviceId: string;
  peerDeviceId: string;
  getSessionId: () => string;
  sendEnvelope: CreatePromptDispatchRuntimeOptions["sendEnvelope"];
  sendTelegram: CreatePromptDispatchRuntimeOptions["sendTelegram"];
  sendTelegramMessage: CreatePromptDispatchGatewayOptions["sendTelegramMessage"];
  runningAgents: CreatePromptDispatchRuntimeOptions["runningAgents"];
  maxParallel?: number;
  processedPromptIds: CreatePromptDispatchRuntimeOptions["processedPromptIds"];
  maxProcessedPrompts: number;
  getDefaultAgent: () => AgentType;
  setStatus: CreatePromptDispatchRuntimeOptions["setStatus"];
  taskUsageMap: CreatePromptDispatchRuntimeOptions["taskUsageMap"];
  taskStartMap: CreatePromptDispatchRuntimeOptions["taskStartMap"];
  nextTaskId: CreatePromptDispatchRuntimeOptions["nextTaskId"];
  getApprovalPort: CreatePromptDispatchRuntimeOptions["getApprovalPort"];
  onUsage: CreatePromptDispatchRuntimeOptions["onUsage"];
  runToolResultHook: CreatePromptDispatchRuntimeOptions["runToolResultHook"];
  collectTaskSummary: CreatePromptDispatchRuntimeOptions["collectTaskSummary"];
  onTaskStarted?: CreatePromptDispatchRuntimeOptions["onTaskStarted"];
  onTaskOutput?: CreatePromptDispatchRuntimeOptions["onTaskOutput"];
  onTaskFinished?: CreatePromptDispatchRuntimeOptions["onTaskFinished"];
  recordProcessLine?: CreatePromptDispatchRuntimeOptions["recordProcessLine"];
  preprocessPromptForExecution: CreatePromptDispatchGatewayOptions["preprocessPromptForExecution"];
  getCwd: () => string;
  getContextUsage: () => TContext;
  compactSummaries: CreatePromptActionsOptions<TContext>["compactSummaries"];
}

function resolveAgentOverride(value?: string): AgentType | undefined {
  if (value === "claude" || value === "codex" || value === "gemini") return value;
  return undefined;
}

export function createPromptDispatchSetup<TContext>(options: CreatePromptDispatchSetupOptions<TContext>) {
  let consumeQueueItem: (item: QueueItem) => void = () => {};

  const processQueueWithConsumer: CreatePromptDispatchRuntimeOptions["processQueue"] = (send) => {
    processQueue(send, options.runningAgents, consumeQueueItem, { maxParallel: options.maxParallel });
  };

  const enqueueFromPrompt = async (prompt: string, agent?: AgentType) => {
    await enqueuePromptTask(prompt, agent, undefined, options.sendEnvelope, options.runningAgents);
  };

  const promptDispatchRuntime = createPromptDispatchRuntime({
    relay: options.relay,
    deviceId: options.deviceId,
    getActiveSessionId: options.getSessionId,
    sendEnvelope: options.sendEnvelope,
    runningAgents: options.runningAgents,
    processedPromptIds: options.processedPromptIds,
    maxProcessedPrompts: options.maxProcessedPrompts,
    getDefaultAgent: options.getDefaultAgent,
    setStatus: options.setStatus,
    taskUsageMap: options.taskUsageMap,
    taskStartMap: options.taskStartMap,
    nextTaskId: options.nextTaskId,
    getApprovalPort: options.getApprovalPort,
    maxParallel: options.maxParallel,
    enqueuePrompt: enqueueFromPrompt,
    processQueue: processQueueWithConsumer,
    sendTelegram: options.sendTelegram,
    onUsage: options.onUsage,
    runToolResultHook: options.runToolResultHook,
    collectTaskSummary: options.collectTaskSummary,
    onTaskStarted: options.onTaskStarted,
    onTaskOutput: options.onTaskOutput,
    onTaskFinished: options.onTaskFinished,
    recordProcessLine: options.recordProcessLine,
  });

  const dispatchPrompt = createPromptDispatchGateway({
    preprocessPromptForExecution: options.preprocessPromptForExecution,
    sendEnvelope: options.sendEnvelope,
    sendTelegram: options.sendTelegram,
    sendTelegramMessage: options.sendTelegramMessage,
    executePrompt: (params) => promptDispatchRuntime.executePrompt(params),
  });

  consumeQueueItem = createQueuePromptConsumer({
    deviceId: options.deviceId,
    peerDeviceId: options.peerDeviceId,
    getSessionId: options.getSessionId,
    resolveAgentOverride,
    dispatchPrompt: (params) => dispatchPrompt(params),
  });

  const { runCompactContext, invokeSkillPrompt } = createPromptActions({
    deviceId: options.deviceId,
    getSessionId: options.getSessionId,
    getCwd: options.getCwd,
    dispatchPrompt: (params) => dispatchPrompt(params),
    getContextUsage: options.getContextUsage,
    compactSummaries: options.compactSummaries,
  });

  return {
    dispatchPrompt,
    consumeQueueItem,
    runCompactContext,
    invokeSkillPrompt,
  };
}

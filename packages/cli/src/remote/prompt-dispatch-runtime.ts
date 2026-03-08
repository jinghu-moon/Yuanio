import { MessageType } from "@yuanio/shared";
import type { AgentStatus, TaskSummaryPayload, UsageInfo, Envelope, IngressPromptSource } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { AgentHandle, AgentType } from "../spawn";
import { dispatchEvent } from "./dispatch";
import { handlePrompt } from "./prompt";

type HandlePromptOptions = Parameters<typeof handlePrompt>[0];

interface HookResultLike {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
}

export interface DispatchPromptParams {
  envelope: Envelope;
  payload: string;
  agentOverride?: AgentType;
  resumeSessionId?: string;
  skipAck?: boolean;
  skipParallelCheck?: boolean;
  source?: IngressPromptSource;
}

export interface CreatePromptDispatchRuntimeOptions {
  relay: RelayClient;
  deviceId: string;
  getActiveSessionId: () => string;
  sendEnvelope: HandlePromptOptions["sendEnvelope"];
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  processedPromptIds: Map<string, number>;
  maxProcessedPrompts: number;
  getDefaultAgent: () => AgentType;
  setStatus: (s: AgentStatus, reason?: string) => void;
  taskUsageMap: Map<string, UsageInfo>;
  taskStartMap: Map<string, number>;
  nextTaskId: () => string;
  getApprovalPort: () => number | undefined;
  maxParallel?: number;
  enqueuePrompt: (prompt: string, agent?: AgentType) => Promise<void>;
  processQueue: (sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>) => void;
  sendTelegram: (message: string) => void | Promise<void>;
  onUsage: (event: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  }) => void;
  runToolResultHook: (
    event: "PostToolUse" | "PostToolUseFailure",
    payload: Record<string, unknown>,
  ) => Promise<HookResultLike | null>;
  collectTaskSummary: (taskId: string) => Promise<TaskSummaryPayload>;
  onTaskStarted?: HandlePromptOptions["onTaskStarted"];
  onTaskOutput?: HandlePromptOptions["onTaskOutput"];
  onTaskFinished?: HandlePromptOptions["onTaskFinished"];
  recordProcessLine?: HandlePromptOptions["recordProcessLine"];
}

export function createPromptDispatchRuntime(options: CreatePromptDispatchRuntimeOptions) {
  const executePrompt = async (params: DispatchPromptParams): Promise<void> => {
    await handlePrompt({
      envelope: params.envelope,
      payload: params.payload,
      relay: options.relay,
      deviceId: options.deviceId,
      activeSessionId: options.getActiveSessionId(),
      sendEnvelope: options.sendEnvelope,
      runningAgents: options.runningAgents,
      processedPromptIds: options.processedPromptIds,
      maxProcessedPrompts: options.maxProcessedPrompts,
      defaultAgent: options.getDefaultAgent(),
      setStatus: options.setStatus,
      taskUsageMap: options.taskUsageMap,
      taskStartMap: options.taskStartMap,
      nextTaskId: options.nextTaskId,
      approvalPort: options.getApprovalPort(),
      agentOverride: params.agentOverride,
      resumeSessionId: params.resumeSessionId,
      skipAck: params.skipAck,
      skipParallelCheck: params.skipParallelCheck,
      maxParallel: options.maxParallel,
      enqueuePrompt: options.enqueuePrompt,
      dispatchEvent: async (ev, agent, send, statusCount, taskId) => {
        if (ev.kind === "usage") {
          options.onUsage(ev);
        }

        if (taskId && ev.kind === "tool_result") {
          const hookEvent = ev.status === "error" ? "PostToolUseFailure" : "PostToolUse";
          const hookResult = await options.runToolResultHook(hookEvent, {
            event: hookEvent,
            taskId,
            tool_name: ev.tool,
            tool: ev.tool,
            status: ev.status,
            result: ev.result,
            cwd: process.cwd(),
          });

          if (hookResult?.blocked) {
            await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
              hook: hookEvent,
              event: "blocked",
              tool: ev.tool,
              taskId,
              reason: hookResult.reason,
            }));
            await options.sendEnvelope(
              MessageType.STREAM_CHUNK,
              `[hook] ${hookEvent} blocked: ${hookResult.reason || "unknown"}`,
            );
          } else if (hookResult && hookResult.injectedContext.length > 0) {
            await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
              hook: hookEvent,
              event: "injected_context",
              tool: ev.tool,
              taskId,
              detail: hookResult.injectedContext.slice(0, 2).join("\n"),
            }));
          }
        }

        await dispatchEvent(ev, agent, send, statusCount, taskId, options.taskUsageMap);
      },
      collectTaskSummary: options.collectTaskSummary,
      processQueue: options.processQueue,
      sendTelegram: options.sendTelegram,
      source: params.source,
      onTaskStarted: options.onTaskStarted,
      onTaskOutput: options.onTaskOutput,
      onTaskFinished: options.onTaskFinished,
      recordProcessLine: options.recordProcessLine,
    });
  };

  return {
    executePrompt,
  };
}

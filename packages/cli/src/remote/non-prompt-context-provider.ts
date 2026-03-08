import type { AgentStatus } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";
import type { PtyController } from "./pty";
import type { NonPromptRouterContext } from "./non-prompt-router";

export interface CreateNonPromptRouterContextProviderOptions {
  sendEnvelope: NonPromptRouterContext["sendEnvelope"];
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  consumeQueueItem: (item: QueueItem) => void;
  maxParallel?: number;
  emitStatusAndTurnState: (status: AgentStatus, reason?: string) => Promise<void> | void;
  sendTelegram: (message: string) => void;
  ptyController: PtyController;
  settleApproval: NonPromptRouterContext["settleApproval"];
  pickPendingApprovalId: NonPromptRouterContext["pickPendingApprovalId"];
  dispatchInteractionPrompt: NonPromptRouterContext["dispatchInteractionPrompt"];
}

export function createNonPromptRouterContextProvider(options: CreateNonPromptRouterContextProviderOptions) {
  return (): NonPromptRouterContext => ({
    sendEnvelope: options.sendEnvelope,
    runningAgents: options.runningAgents,
    consumeQueueItem: options.consumeQueueItem,
    maxParallel: options.maxParallel,
    sendStatus: (status, reason) => options.emitStatusAndTurnState(status, reason),
    sendTelegram: options.sendTelegram,
    ptyController: options.ptyController,
    settleApproval: options.settleApproval,
    pickPendingApprovalId: options.pickPendingApprovalId,
    dispatchInteractionPrompt: options.dispatchInteractionPrompt,
  });
}

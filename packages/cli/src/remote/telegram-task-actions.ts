import { MessageType } from "@yuanio/shared";
import type { AgentStatus } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";
import { handleCancel } from "./cancel";
import { sendQueueStatus } from "./queue";

export interface TelegramTaskActionsContext {
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  emitStatus: (s: AgentStatus, reason?: string) => Promise<void> | void;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  sendTelegram: (message: string) => void;
  clearQueue: () => number;
}

export function createTelegramTaskActions(ctx: TelegramTaskActionsContext) {
  return {
    stopTasks: async (reason: string): Promise<void> => {
      await handleCancel(JSON.stringify({ reason }), {
        runningAgents: ctx.runningAgents,
        sendStatus: ctx.emitStatus,
        sendEnvelope: ctx.sendEnvelope,
        sendTelegram: ctx.sendTelegram,
      });
    },
    clearTasksAndQueue: async (reason: string): Promise<{ runningCount: number; clearedQueue: number }> => {
      const runningCount = ctx.runningAgents.size;
      if (runningCount > 0) {
        await handleCancel(JSON.stringify({ reason }), {
          runningAgents: ctx.runningAgents,
          sendStatus: ctx.emitStatus,
          sendEnvelope: ctx.sendEnvelope,
          sendTelegram: ctx.sendTelegram,
        });
      }
      const clearedQueue = ctx.clearQueue();
      await sendQueueStatus(ctx.sendEnvelope, ctx.runningAgents);
      return { runningCount, clearedQueue };
    },
  };
}

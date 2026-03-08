import { MessageType } from "@yuanio/shared";
import type { TaskQueuePayload } from "@yuanio/shared";
import {
  enqueue,
  dequeue,
  clearQueue,
  queueSize,
  buildQueueStatus,
  getQueueMode,
} from "../task-queue";
import type { AgentHandle, AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";

export interface QueueOptions {
  maxParallel?: number;
}

export async function handleTaskQueue(
  tq: TaskQueuePayload,
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>,
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>,
  onConsume?: (item: QueueItem) => void,
  options?: QueueOptions,
): Promise<void> {
  switch (tq.action) {
    case "enqueue": {
      if (!tq.prompt) break;
      const item = enqueue(tq.prompt, tq.agent, tq.priority);
      console.log(`[queue] 入队: ${item.id}`);
      await sendQueueStatus(sendEnvelope, runningAgents);
      processQueue(sendEnvelope, runningAgents, onConsume, options);
      break;
    }
    case "status": {
      await sendQueueStatus(sendEnvelope, runningAgents);
      break;
    }
    case "clear": {
      const count = clearQueue();
      console.log(`[queue] 清空 ${count} 个任务`);
      await sendQueueStatus(sendEnvelope, runningAgents);
      break;
    }
  }
}

export async function sendQueueStatus(
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>,
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>,
): Promise<void> {
  const runningIds = Array.from(runningAgents.keys());
  const status = buildQueueStatus(runningIds);
  await sendEnvelope(
    MessageType.TASK_QUEUE_STATUS,
    JSON.stringify(status),
  );
}

export function processQueue(
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>,
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>,
  onConsume?: (item: QueueItem) => void,
  options?: QueueOptions,
): void {
  const mode = getQueueMode();
  const maxParallel = options?.maxParallel;
  if (mode === "sequential" && runningAgents.size > 0) return;
  if (maxParallel && runningAgents.size >= maxParallel) return;
  if (queueSize() === 0) return;

  const item = dequeue();
  if (!item) return;

  console.log(`[queue] 消费: ${item.id} → "${item.prompt.slice(0, 50)}"`);
  void sendQueueStatus(sendEnvelope, runningAgents);
  if (onConsume) {
    onConsume(item);
  }
}

export async function enqueuePrompt(
  prompt: string,
  agent: AgentType | undefined,
  priority: number | undefined,
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>,
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>,
): Promise<QueueItem> {
  const item = enqueue(prompt, agent, priority);
  console.log(`[queue] 入队: ${item.id}`);
  await sendQueueStatus(sendEnvelope, runningAgents);
  return item;
}

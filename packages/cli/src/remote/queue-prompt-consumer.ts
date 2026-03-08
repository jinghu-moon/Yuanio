import { MessageType } from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";
import type { AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";
import type { DispatchPromptParams } from "./prompt-dispatch-runtime";

export interface CreateQueuePromptConsumerOptions {
  deviceId: string;
  peerDeviceId: string;
  getSessionId: () => string;
  resolveAgentOverride: (value?: string) => AgentType | undefined;
  dispatchPrompt: (params: DispatchPromptParams) => Promise<void>;
}

export function createQueuePromptConsumer(options: CreateQueuePromptConsumerOptions) {
  return (item: QueueItem) => {
    const agentOverride = options.resolveAgentOverride(item.agent);
    const fakeEnvelope: Envelope = {
      id: item.id,
      seq: 0,
      source: options.deviceId,
      target: options.peerDeviceId,
      sessionId: options.getSessionId(),
      type: MessageType.PROMPT,
      ts: Date.now(),
      payload: "",
    };
    void options.dispatchPrompt({
      envelope: fakeEnvelope,
      payload: item.prompt,
      agentOverride,
      skipAck: true,
      skipParallelCheck: true,
      source: "queue",
    });
  };
}

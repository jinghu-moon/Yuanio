import { MessageType } from "@yuanio/shared";
import type { AgentStatus } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";

export async function handleCancel(
  payloadText: string,
  deps: {
    runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
    sendStatus: (s: AgentStatus, reason?: string) => Promise<void> | void;
    sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
    sendTelegram: (message: string) => void;
  },
): Promise<void> {
  const cancelPayload = payloadText
    ? (() => { try { return JSON.parse(payloadText); } catch { return {}; } })()
    : {};
  const targetId = cancelPayload.taskId as string | undefined;

  if (targetId && deps.runningAgents.has(targetId)) {
    deps.runningAgents.get(targetId)!.handle.kill();
    deps.runningAgents.delete(targetId);
    console.log(`[remote] 中止任务 ${targetId}`);
  } else {
    for (const [id, { handle }] of deps.runningAgents) {
      handle.kill();
      console.log(`[remote] 中止任务 ${id}`);
    }
    deps.runningAgents.clear();
  }

  await deps.sendStatus("idle", "cancel");
  await deps.sendEnvelope(MessageType.STREAM_END, "");
  deps.sendTelegram("任务已中止");
}

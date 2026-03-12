import { describe, expect, it } from "bun:test";
import { handleWsAckFrame, handleWsMessageFrame } from "../ws-message-handler";
import { MessageType } from "@yuanio/shared";
import type { AckMessage, Envelope } from "@yuanio/shared";

const baseSender = {
  deviceId: "agent-1",
  sessionId: "session-1",
  role: "agent",
  namespace: "default",
};

describe("ws message handler", () => {
  it("message 应持久化并写入投递队列", () => {
    const persisted: Envelope[] = [];
    const queued: Array<{ messageId: string; targetDeviceId: string }> = [];
    const delivered: Array<{ deviceId: string; type: string }> = [];

    handleWsMessageFrame({
      envelope: {
        id: "msg-1",
        seq: 1,
        source: "agent-1",
        target: "broadcast",
        sessionId: "session-1",
        type: MessageType.PROMPT,
        ts: 1700000000000,
        payload: "payload",
      },
      sender: baseSender,
      deps: {
        shouldPersist: () => true,
        shouldQueueAck: () => true,
        getSessionDevices: () => [{ id: "app-1", role: "app" }],
        sendToDevice: (deviceId, frame) => {
          delivered.push({ deviceId, type: (frame as { type: string }).type });
        },
        persistEnvelope: (envelope) => persisted.push(envelope),
        queueDeliveries: (rows) => queued.push(...rows),
      },
    });

    expect(persisted.length).toBe(1);
    expect(queued.length).toBe(1);
    expect(queued[0]?.targetDeviceId).toBe("app-1");
    expect(delivered[0]?.deviceId).toBe("app-1");
  });

  it("ack 应转发并标记投递完成", () => {
    const marked: Array<{ messageId: string; deviceId: string }> = [];
    const forwarded: Array<{ deviceId: string; type: string }> = [];

    handleWsAckFrame({
      ack: {
        messageId: "msg-1",
        source: "app",
        sessionId: "session-1",
        state: "ok",
        at: 1700000000100,
      } satisfies AckMessage,
      sender: {
        deviceId: "app-1",
        sessionId: "session-1",
        role: "app",
        namespace: "default",
      },
      deps: {
        getOnlinePeers: () => ["agent-1"],
        markAcked: (messageId, deviceId) => marked.push({ messageId, deviceId }),
        sendToDevice: (deviceId, frame) => {
          forwarded.push({ deviceId, type: (frame as { type: string }).type });
        },
      },
    });

    expect(marked.length).toBe(1);
    expect(marked[0]?.messageId).toBe("msg-1");
    expect(forwarded[0]?.deviceId).toBe("agent-1");
  });
});

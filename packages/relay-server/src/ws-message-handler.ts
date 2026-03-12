import { ACK_REQUIRED_TYPES, AckMessageSchema, EnvelopeSchema } from "@yuanio/shared";
import type { AckMessage, Envelope, BinaryEnvelope, AckState } from "@yuanio/shared";
import { resolveDeliveryTargets } from "./delivery-queue";

export type WsSenderContext = {
  deviceId: string;
  sessionId: string;
  role: string;
  namespace: string;
};

export type WsDeliveryRow = {
  messageId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
};

export type WsMessageDeps = {
  shouldPersist: (type?: string) => boolean;
  shouldQueueAck: (type?: string) => boolean;
  getSessionDevices: (sessionId: string) => { id: string; role: string }[];
  sendToDevice: (deviceId: string, frame: unknown) => void;
  persistEnvelope: (envelope: Envelope) => void;
  queueDeliveries: (rows: WsDeliveryRow[]) => void;
  trackAckExpectations?: (messageId: string, targets: string[], recvAt: number) => void;
  now?: () => number;
};

export type WsAckDeps = {
  getOnlinePeers: (sessionId: string, sourceDeviceId: string) => string[];
  sendToDevice: (deviceId: string, frame: unknown) => void;
  markAcked?: (messageId: string, deviceId: string) => void;
  observeAck?: (messageId: string, deviceId: string, state?: AckState) => void;
};

export function handleWsMessageFrame(args: {
  envelope: Envelope | BinaryEnvelope;
  sender: WsSenderContext;
  deps: WsMessageDeps;
}) {
  const { envelope, sender, deps } = args;
  const normalized = EnvelopeSchema.parse({
    ...envelope,
    source: sender.deviceId,
    sessionId: sender.sessionId,
  }) as Envelope | BinaryEnvelope;

  const normalizedTarget = typeof normalized.target === "string" && normalized.target.length > 0
    ? normalized.target
    : "broadcast";
  const devices = deps.getSessionDevices(sender.sessionId);
  const targets = resolveDeliveryTargets(normalizedTarget, sender.deviceId, devices);
  for (const targetDeviceId of targets) {
    deps.sendToDevice(targetDeviceId, { type: "message", data: normalized });
  }

  if (deps.shouldPersist(normalized.type) && typeof normalized.payload === "string") {
    deps.persistEnvelope(normalized as Envelope);
  }

  if (deps.shouldQueueAck(normalized.type)) {
    const rows = targets.map((targetDeviceId) => ({
      messageId: normalized.id,
      sessionId: sender.sessionId,
      sourceDeviceId: sender.deviceId,
      targetDeviceId,
    }));
    deps.queueDeliveries(rows);
    if (deps.trackAckExpectations && rows.length > 0) {
      deps.trackAckExpectations(normalized.id, targets, deps.now?.() ?? Date.now());
    }
  }
}

export function handleWsAckFrame(args: {
  ack: AckMessage;
  sender: WsSenderContext;
  deps: WsAckDeps;
}) {
  const { ack, sender, deps } = args;
  const normalizedAck = AckMessageSchema.parse({
    ...ack,
    source: sender.deviceId,
    sessionId: sender.sessionId,
  });
  if (normalizedAck.state !== "retry_after" && deps.markAcked) {
    deps.markAcked(normalizedAck.messageId, sender.deviceId);
  }
  deps.observeAck?.(normalizedAck.messageId, sender.deviceId, normalizedAck.state);
  const targets = deps.getOnlinePeers(sender.sessionId, sender.deviceId);
  for (const targetDeviceId of targets) {
    deps.sendToDevice(targetDeviceId, { type: "ack", data: normalizedAck });
  }
}

export function shouldQueueAckByType(type?: string): boolean {
  if (!type) return false;
  return ACK_REQUIRED_TYPES.includes(type as any);
}

import { MessageType, openEnvelopeWeb, openBinaryEnvelopeWeb } from "@yuanio/shared";
import type { Envelope, BinaryEnvelope } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { InboundEnvelopeTracker } from "./inbound-tracker";

export interface CreateEnvelopeHandlerOptions {
  relay: RelayClient;
  deviceId: string;
  getSessionId: () => string;
  getSharedKey: () => CryptoKey;
  inboundTracker: InboundEnvelopeTracker;
  onControlEnvelope: (envelope: Envelope | BinaryEnvelope, payload: string) => Promise<boolean>;
  onRpcEnvelope: (envelope: Envelope | BinaryEnvelope, payload: string) => Promise<void> | void;
  onNonPromptEnvelope: (envelope: Envelope | BinaryEnvelope, payload: string) => Promise<boolean>;
  onPromptEnvelope: (envelope: Envelope | BinaryEnvelope, payload: string) => Promise<void>;
}

export function createEnvelopeHandler(options: CreateEnvelopeHandlerOptions) {
  return async (envelope: Envelope | BinaryEnvelope) => {
    const source = typeof envelope.source === "string" ? envelope.source : "";
    const inboundSeq = typeof envelope.seq === "number" ? envelope.seq : 0;
    if (source) {
      options.inboundTracker.trackInboundSeq(source, inboundSeq);
    }

    const envelopeId = typeof envelope.id === "string" ? envelope.id : "";
    if (envelopeId) {
      if (options.inboundTracker.isDuplicate(envelopeId)) {
        if (envelope.type === MessageType.PROMPT) {
          const ackSessionId = typeof envelope.sessionId === "string" && envelope.sessionId
            ? envelope.sessionId
            : options.getSessionId();
          options.relay.sendAck(envelopeId, options.deviceId, ackSessionId);
        }
        return;
      }
      options.inboundTracker.remember(envelopeId);
    }

    const isPty = typeof envelope.type === "string" && envelope.type.startsWith("pty_");
    let payload: string;
    try {
      payload = isPty
        ? await openBinaryEnvelopeWeb(envelope as BinaryEnvelope, options.getSharedKey())
        : await openEnvelopeWeb(envelope as Envelope, options.getSharedKey());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[remote] 解密失败:", msg);
      return;
    }

    const controlHandled = await options.onControlEnvelope(envelope, payload);
    if (controlHandled) return;

    if (envelope.type === MessageType.RPC_REQ) {
      await options.onRpcEnvelope(envelope, payload);
      return;
    }

    const nonPromptHandled = await options.onNonPromptEnvelope(envelope, payload);
    if (nonPromptHandled) return;

    if (envelope.type !== MessageType.PROMPT) return;
    await options.onPromptEnvelope(envelope, payload);
  };
}

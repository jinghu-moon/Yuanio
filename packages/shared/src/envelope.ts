import type { Envelope, BinaryEnvelope, MessageType } from "./types";
import { encrypt, decrypt, encryptRaw, decryptRaw, generateUUIDv7 } from "./crypto";

// 每个发送端维护独立的 seq 计数器
export class SeqCounter {
  private seq = 0;
  next(): number { return ++this.seq; }
  current(): number { return this.seq; }
}

export function createEnvelope(
  source: string,
  target: string,
  sessionId: string,
  type: MessageType,
  plaintext: string,
  sharedKey: Uint8Array,
  seq: number = 0,
  ptyId?: string,
): Envelope {
  return {
    id: generateUUIDv7(),
    seq,
    source,
    target,
    sessionId,
    type,
    ptyId,
    ts: Date.now(),
    payload: encrypt(plaintext, sharedKey),
  };
}

export function openEnvelope(envelope: Envelope, sharedKey: Uint8Array): string {
  return decrypt(envelope.payload, sharedKey);
}

// --- Binary 变体：PTY 等高频消息，省去 Base64 膨胀 ---

export function createBinaryEnvelope(
  source: string, target: string, sessionId: string,
  type: MessageType, plaintext: string,
  sharedKey: Uint8Array, seq: number = 0, ptyId?: string,
): BinaryEnvelope {
  return {
    id: generateUUIDv7(), seq, source, target, sessionId, type, ptyId,
    ts: Date.now(),
    payload: encryptRaw(plaintext, sharedKey),
  };
}

export function openBinaryEnvelope(envelope: BinaryEnvelope, sharedKey: Uint8Array): string {
  const data = envelope.payload instanceof Uint8Array
    ? envelope.payload
    : new Uint8Array(envelope.payload as ArrayBuffer);
  return decryptRaw(data, sharedKey);
}

import type { Envelope, BinaryEnvelope, MessageType } from "./types";
import { SeqCounter } from "./envelope";
import { encryptAead, decryptAead, encryptAeadRaw, decryptAeadRaw } from "./crypto-web";
import { generateUUIDv7 } from "./crypto";

function buildEnvelopeAad(input: {
  id: string;
  seq: number;
  source: string;
  target: string;
  sessionId: string;
  type: MessageType;
  ptyId?: string;
  ts: number;
}): string {
  const aad: Record<string, unknown> = {
    v: 1,
    id: input.id,
    seq: input.seq,
    source: input.source,
    target: input.target,
    sessionId: input.sessionId,
    type: input.type,
    ts: input.ts,
  };
  if (input.ptyId) aad.ptyId = input.ptyId;
  return JSON.stringify(aad);
}

export async function createEnvelopeWeb(
  source: string,
  target: string,
  sessionId: string,
  type: MessageType,
  plaintext: string,
  key: CryptoKey,
  seq: number = 0,
  ptyId?: string,
): Promise<Envelope> {
  const env = {
    id: generateUUIDv7(),
    seq,
    source,
    target,
    sessionId,
    type,
    ptyId,
    ts: Date.now(),
  };
  const aad = buildEnvelopeAad(env);
  return {
    ...env,
    payload: await encryptAead(plaintext, key, aad),
  };
}

export async function openEnvelopeWeb(envelope: Envelope, key: CryptoKey): Promise<string> {
  const aad = buildEnvelopeAad(envelope);
  if (typeof envelope.payload !== "string") {
    throw new Error("binary payload requires openBinaryEnvelopeWeb");
  }
  return decryptAead(envelope.payload, key, aad);
}

export async function createBinaryEnvelopeWeb(
  source: string,
  target: string,
  sessionId: string,
  type: MessageType,
  plaintext: string,
  key: CryptoKey,
  seq: number = 0,
  ptyId?: string,
): Promise<BinaryEnvelope> {
  const env = {
    id: generateUUIDv7(),
    seq,
    source,
    target,
    sessionId,
    type,
    ptyId,
    ts: Date.now(),
  };
  const aad = buildEnvelopeAad(env);
  return {
    ...env,
    payload: await encryptAeadRaw(plaintext, key, aad),
  };
}

export async function openBinaryEnvelopeWeb(envelope: BinaryEnvelope, key: CryptoKey): Promise<string> {
  const aad = buildEnvelopeAad(envelope);
  return decryptAeadRaw(envelope.payload, key, aad);
}

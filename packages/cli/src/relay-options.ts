import { PROTOCOL_VERSION, WsFrameSchema } from "@yuanio/shared";
import type { AckMessage, BinaryEnvelope, Envelope } from "@yuanio/shared";
import type { RawData } from "ws";
import { WebSocket } from "ws";

type BufferJsonPayload = { type: "Buffer"; data: number[] };

export type RelayHelloOptions = {
  protocolVersion?: string;
  namespace?: string;
  deviceId?: string;
  role?: "agent" | "app";
  clientVersion?: string;
};

export function buildRelayWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const protocol = url.protocol;
  url.protocol = protocol === "https:" || protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = "/relay-ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function createRelayHelloFrame(token: string, options?: RelayHelloOptions) {
  const data: Record<string, unknown> = {
    token,
    protocolVersion: options?.protocolVersion ?? PROTOCOL_VERSION,
  };
  if (options?.namespace) data.namespace = options.namespace;
  if (options?.deviceId) data.deviceId = options.deviceId;
  if (options?.role) data.role = options.role;
  if (options?.clientVersion) data.clientVersion = options.clientVersion;
  return { type: "hello", data };
}

export function connectRelayWs(
  serverUrl: string,
  token: string,
  options?: RelayHelloOptions,
): WebSocket {
  const socket = new WebSocket(buildRelayWsUrl(serverUrl));
  socket.on("open", () => {
    socket.send(encodeWsFrame(createRelayHelloFrame(token, options)));
  });
  return socket;
}

export async function waitForWsOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("ws connect timeout"));
    }, Math.max(500, timeoutMs));
    socket.on("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      reject(new Error(message));
    });
  });
}

export function encodeWsFrame(frame: unknown): string {
  return JSON.stringify(frame);
}

export function sendWsFrame(socket: WebSocket, frame: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(encodeWsFrame(frame));
}

export function decodeWsData(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf-8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf-8");
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return buf.toString("utf-8");
}

export function parseWsFrame(raw: string): { ok: true; frame: unknown } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid json" };
  }
  const result = WsFrameSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: "invalid ws frame" };
  return { ok: true, frame: result.data };
}

function isBufferJsonPayload(value: unknown): value is BufferJsonPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as { type?: unknown; data?: unknown };
  if (payload.type !== "Buffer" || !Array.isArray(payload.data)) return false;
  return payload.data.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

export function normalizeEnvelopePayload(envelope: Envelope | BinaryEnvelope): Envelope | BinaryEnvelope {
  const payload = (envelope as { payload?: unknown }).payload;
  if (isBufferJsonPayload(payload)) {
    return { ...envelope, payload: Uint8Array.from(payload.data) } as BinaryEnvelope;
  }
  return envelope;
}

export function isTextEnvelope(envelope: Envelope | BinaryEnvelope): envelope is Envelope {
  return typeof (envelope as { payload?: unknown }).payload === "string";
}

export function toWsMessageFrame(envelope: Envelope | BinaryEnvelope) {
  const payload = (envelope as { payload?: unknown }).payload;
  if (payload instanceof Uint8Array) {
    return {
      type: "message",
      data: {
        ...envelope,
        payload: { type: "Buffer", data: Array.from(payload) },
      },
    };
  }
  if (payload instanceof ArrayBuffer) {
    return {
      type: "message",
      data: {
        ...envelope,
        payload: { type: "Buffer", data: Array.from(new Uint8Array(payload)) },
      },
    };
  }
  return { type: "message", data: envelope };
}

export function toWsAckFrame(ack: AckMessage) {
  return { type: "ack", data: ack };
}

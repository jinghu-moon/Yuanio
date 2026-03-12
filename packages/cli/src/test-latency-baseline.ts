import {
  MessageType,
  SeqCounter,
  createBinaryEnvelopeWeb,
  createEnvelopeWeb,
  deriveAesGcmKey,
  generateWebKeyPair,
  openBinaryEnvelopeWeb,
  openEnvelopeWeb,
  type AckMessage,
  type BinaryEnvelope,
  type Envelope,
  type WebKeyPair,
} from "@yuanio/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  connectRelayWs,
  decodeWsData,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsAckFrame,
  toWsMessageFrame,
  waitForWsOpen,
} from "./relay-options";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

interface PairCreateResponse {
  pairingCode: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
}

interface PairJoinResponse {
  agentPublicKey: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
}

interface QuantileSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

interface RelayEventLoopLagSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  last: number;
}

interface RelayHealthSnapshot {
  serverNowMs: number;
  eventLoopLagMs: RelayEventLoopLagSummary;
}

interface ClockOffsetEstimate {
  offsetMs: number;
  rttMs: number;
  samples: number;
}

interface HandshakeMetrics {
  pairCreateMs: number;
  pairJoinMs: number;
  deriveAgentKeyMs: number;
  deriveAppKeyMs: number;
  agentConnectMs: number;
  appConnectMs: number;
}

interface TextSample {
  appEncodeMs: number;
  agentDecryptMs?: number;
  agentEncodeChunkMs?: number;
  appDecryptChunkMs?: number;
  sendToRelayMs: number;
  relayToAgentMs: number;
  sendToAgentMs: number;
  sendToAckMs: number;
  sendToFirstChunkMs: number;
  agentChunkToAppMs: number;
  sendToEndMs: number;
}

interface BinarySample {
  appEncodeMs: number;
  agentDecryptMs?: number;
  agentEncodeMs?: number;
  appDecryptMs?: number;
  sendToAgentMs: number;
  sendToEchoMs: number;
  agentToAppMs: number;
}

interface ScenarioResult {
  name: string;
  warmup: number;
  iterations: number;
  payloadBytes: Record<string, number>;
  metrics: Record<string, QuantileSummary>;
}

interface BenchmarkResult {
  generatedAt: string;
  environment: {
    os: string;
    arch: string;
    bunVersion: string;
    nodeVersion: string;
    serverUrl: string;
    autoRelay: boolean;
    relayClockOffsetMs: number;
    relayClockRttMs: number;
    relayClockSamples: number;
    relayEventLoopLagStart: RelayEventLoopLagSummary;
    relayEventLoopLagEnd: RelayEventLoopLagSummary;
  };
  handshake: HandshakeMetrics;
  scenarios: ScenarioResult[];
}

interface TextCaseConfig {
  name: string;
  warmup: number;
  iterations: number;
  promptBytes: number;
  chunkBytes: number;
}

interface BinaryCaseConfig {
  name: string;
  warmup: number;
  iterations: number;
  inputBytes: number;
  outputBytes: number;
}

interface TextIterationState {
  promptId: string;
  sentAtPerfMs: number;
  sentAtWallMs: number;
  appEncodeMs: number;
  chunkDecoded: boolean;
  endSeen: boolean;
  agentDecryptMs?: number;
  agentEncodeChunkMs?: number;
  appDecryptChunkMs?: number;
  sendToRelayMs?: number;
  relayToAgentMs?: number;
  sendToAgentMs?: number;
  sendToAckMs?: number;
  sendToFirstChunkMs?: number;
  agentChunkToAppMs?: number;
  sendToEndMs?: number;
  done?: () => void;
  fail?: (err: Error) => void;
  timer?: Timer;
}

interface BinaryIterationState {
  requestId: string;
  sentAtPerfMs: number;
  sentAtWallMs: number;
  appEncodeMs: number;
  agentDecryptMs?: number;
  agentEncodeMs?: number;
  appDecryptMs?: number;
  sendToAgentMs?: number;
  sendToEchoMs?: number;
  agentToAppMs?: number;
  done?: () => void;
  fail?: (err: Error) => void;
  timer?: Timer;
}

interface ConnectedSocket {
  socket: WebSocket;
  connectMs: number;
}

const args = Bun.argv.slice(2);

function arg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  return args[idx + 1] ?? fallback;
}

function argInt(name: string, fallback: number): number {
  const raw = arg(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const serverUrl = arg("--server", "http://127.0.0.1:3000");
const warmup = argInt("--warmup", 10);
const iterations = argInt("--iterations", 60);
const autoRelay = !hasFlag("--no-auto-relay");
const mdOutputPath = arg("--out", "docs/latency-baseline.md");
const jsonOutputPath = arg("--json-out", "docs/latency-baseline.json");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../../..");

function resolveServerPort(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const port = Number(parsed.port);
      if (Number.isFinite(port) && port > 0) return port;
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 3000;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

function perfNowMs(): number {
  return performance.now();
}

const wallPerfOriginMs = Date.now() - perfNowMs();

function wallNowMs(): number {
  return wallPerfOriginMs + perfNowMs();
}

function emptyEventLoopLagSummary(): RelayEventLoopLagSummary {
  return { count: 0, p50: 0, p95: 0, max: 0, last: 0 };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = perfNowMs();
  const value = await fn();
  return { value, ms: perfNowMs() - start };
}

function makePayload(prefix: string, targetBytes: number): string {
  if (targetBytes <= prefix.length + 2) return prefix;
  const seed = `${prefix}|`;
  const bodyLength = Math.max(0, targetBytes - seed.length);
  return seed + "x".repeat(bodyLength);
}

function toNumberArray(values: Array<number | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const weight = rank - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function summarize(values: number[]): QuantileSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, item) => acc + item, 0);
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function fmtMs(ms: number): string {
  return ms.toFixed(2);
}

function normalizeBinaryPayload(rawPayload: unknown): Uint8Array | null {
  if (rawPayload instanceof Uint8Array) return rawPayload;
  if (rawPayload instanceof ArrayBuffer) return new Uint8Array(rawPayload);
  if (Buffer.isBuffer(rawPayload)) return new Uint8Array(rawPayload);
  if (Array.isArray(rawPayload)) return Uint8Array.from(rawPayload);
  if (
    rawPayload &&
    typeof rawPayload === "object" &&
    "type" in rawPayload &&
    (rawPayload as { type?: unknown }).type === "Buffer" &&
    "data" in rawPayload
  ) {
    const maybe = (rawPayload as { data?: unknown }).data;
    if (Array.isArray(maybe)) return Uint8Array.from(maybe);
  }
  return null;
}

function toEnvelope(raw: unknown): Envelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string") return null;
  if (typeof obj.type !== "string") return null;
  if (typeof obj.payload !== "string") return null;
  if (typeof obj.seq !== "number" || typeof obj.ts !== "number") return null;
  if (typeof obj.source !== "string" || typeof obj.target !== "string" || typeof obj.sessionId !== "string") {
    return null;
  }
  return obj as unknown as Envelope;
}

function toBinaryEnvelope(raw: unknown): BinaryEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const payload = normalizeBinaryPayload(obj.payload);
  if (!payload) return null;
  if (typeof obj.id !== "string") return null;
  if (typeof obj.type !== "string") return null;
  if (typeof obj.seq !== "number" || typeof obj.ts !== "number") return null;
  if (typeof obj.source !== "string" || typeof obj.target !== "string" || typeof obj.sessionId !== "string") {
    return null;
  }
  return {
    id: obj.id,
    seq: obj.seq,
    source: obj.source,
    target: obj.target,
    sessionId: obj.sessionId,
    type: obj.type as MessageType,
    ts: obj.ts,
    ptyId: typeof obj.ptyId === "string" ? obj.ptyId : undefined,
    payload,
  };
}

function parseRelayEventLoopLag(raw: unknown): RelayEventLoopLagSummary {
  if (!raw || typeof raw !== "object") return emptyEventLoopLagSummary();
  const obj = raw as Record<string, unknown>;
  const count = typeof obj.count === "number" ? obj.count : 0;
  const p50 = typeof obj.p50 === "number" ? obj.p50 : 0;
  const p95 = typeof obj.p95 === "number" ? obj.p95 : 0;
  const max = typeof obj.max === "number" ? obj.max : 0;
  const last = typeof obj.last === "number" ? obj.last : 0;
  return { count, p50, p95, max, last };
}

async function fetchRelayHealth(url: string): Promise<RelayHealthSnapshot | null> {
  try {
    const response = await fetch(`${url}/health`);
    if (!response.ok) return null;
    const json = await response.json() as Record<string, unknown>;
    const serverNowMs = typeof json.serverNowMs === "number" ? json.serverNowMs : wallNowMs();
    return {
      serverNowMs,
      eventLoopLagMs: parseRelayEventLoopLag(json.eventLoopLagMs),
    };
  } catch {
    return null;
  }
}

async function waitRelayHealthy(url: string, timeoutMs: number): Promise<RelayHealthSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await fetchRelayHealth(url);
    if (snapshot) return snapshot;
    await sleep(200);
  }
  throw new Error(`relay 健康检查超时: ${url}`);
}

async function estimateRelayClockOffset(url: string, probes: number = 7): Promise<ClockOffsetEstimate> {
  const rows: Array<{ offsetMs: number; rttMs: number }> = [];
  for (let i = 0; i < probes; i += 1) {
    const requestStartPerf = perfNowMs();
    const requestStartWall = wallNowMs();
    const snapshot = await fetchRelayHealth(url);
    const requestEndPerf = perfNowMs();
    const requestEndWall = wallNowMs();
    if (!snapshot) {
      await sleep(40);
      continue;
    }
    const rttMs = requestEndPerf - requestStartPerf;
    const midpointWallMs = requestStartWall + ((requestEndWall - requestStartWall) / 2);
    const offsetMs = snapshot.serverNowMs - midpointWallMs;
    rows.push({ offsetMs, rttMs });
    await sleep(40);
  }

  if (rows.length === 0) {
    return { offsetMs: 0, rttMs: 0, samples: 0 };
  }

  const best = [...rows].sort((a, b) => a.rttMs - b.rttMs)[0]!;
  return {
    offsetMs: best.offsetMs,
    rttMs: best.rttMs,
    samples: rows.length,
  };
}

async function createPair(server: string, publicKey: string): Promise<PairCreateResponse> {
  const response = await fetch(`${server}/api/v1/pair/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey }),
  });
  if (!response.ok) {
    throw new Error(`pair/create 失败: ${response.status} ${await response.text()}`);
  }
  return await response.json() as PairCreateResponse;
}

async function joinPair(server: string, code: string, publicKey: string): Promise<PairJoinResponse> {
  const response = await fetch(`${server}/api/v1/pair/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, publicKey }),
  });
  if (!response.ok) {
    throw new Error(`pair/join 失败: ${response.status} ${await response.text()}`);
  }
  return await response.json() as PairJoinResponse;
}

async function connectSocket(name: string, url: string, token: string): Promise<ConnectedSocket> {
  const startedAt = perfNowMs();
  const socket = connectRelayWs(url, token);
  await waitForWsOpen(socket, 10_000);
  return {
    socket,
    connectMs: perfNowMs() - startedAt,
  };
}

function onWsEnvelope(
  socket: WebSocket,
  handler: (env: Envelope | BinaryEnvelope) => void,
): () => void {
  const onMessage = (data: any) => {
    const parsed = parseWsFrame(decodeWsData(data));
    if (!parsed.ok) return;
    const frame = parsed.frame as { type: string; data?: unknown };
    if (frame.type !== "message") return;
    const env = normalizeEnvelopePayload(frame.data as Envelope | BinaryEnvelope);
    handler(env);
  };
  socket.on("message", onMessage);
  return () => socket.off("message", onMessage);
}

function onWsAck(
  socket: WebSocket,
  handler: (ack: AckMessage) => void,
): () => void {
  const onMessage = (data: any) => {
    const parsed = parseWsFrame(decodeWsData(data));
    if (!parsed.ok) return;
    const frame = parsed.frame as { type: string; data?: unknown };
    if (frame.type !== "ack") return;
    handler(frame.data as AckMessage);
  };
  socket.on("message", onMessage);
  return () => socket.off("message", onMessage);
}

function ensureMetric(value: number | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`缺少指标: ${label}`);
}

async function runTextScenario(params: {
  name: string;
  appSocket: WebSocket;
  agentSocket: WebSocket;
  appKey: CryptoKey;
  agentKey: CryptoKey;
  appDeviceId: string;
  agentDeviceId: string;
  sessionId: string;
  warmup: number;
  iterations: number;
  promptBytes: number;
  chunkBytes: number;
  relayClockOffsetMs: number;
}): Promise<ScenarioResult> {
  const {
    name,
    appSocket,
    agentSocket,
    appKey,
    agentKey,
    appDeviceId,
    agentDeviceId,
    sessionId,
    warmup,
    iterations,
    promptBytes,
    chunkBytes,
    relayClockOffsetMs,
  } = params;

  const appSeq = new SeqCounter();
  const agentSeq = new SeqCounter();
  const samples: TextSample[] = [];
  const timeoutMs = 8_000;

  let state: TextIterationState | null = null;
  let chunkPayload = makePayload(`${name}-chunk`, chunkBytes);

  const cleanupState = () => {
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state = null;
  };

  const onAppAck = (ack: AckMessage) => {
    const current = state;
    if (!current) return;
    if (ack.messageId !== current.promptId) return;
    current.sendToAckMs = perfNowMs() - current.sentAtPerfMs;
  };

  const onAppMessage = async (raw: unknown) => {
    const current = state;
    if (!current) return;
    const env = toEnvelope(raw);
    if (!env) return;

    if (env.type === MessageType.STREAM_CHUNK && current.sendToFirstChunkMs === undefined) {
      const nowPerf = perfNowMs();
      const nowWall = wallNowMs();
      current.sendToFirstChunkMs = nowPerf - current.sentAtPerfMs;
      current.agentChunkToAppMs = nowWall - env.ts;
      const decrypted = await timed(() => openEnvelopeWeb(env, appKey));
      if (state?.promptId !== current.promptId) return;
      current.appDecryptChunkMs = decrypted.ms;
      current.chunkDecoded = true;
      if (decrypted.value.length !== chunkPayload.length) {
        current.fail?.(new Error("chunk 解密长度不一致"));
        return;
      }
      if (current.endSeen) current.done?.();
      return;
    }

    if (env.type === MessageType.STREAM_END) {
      current.sendToEndMs = perfNowMs() - current.sentAtPerfMs;
      current.endSeen = true;
      if (current.chunkDecoded || current.sendToFirstChunkMs === undefined) {
        current.done?.();
      }
    }
  };

  const onAgentMessage = async (raw: unknown) => {
    const current = state;
    if (!current) return;
    const env = toEnvelope(raw);
    if (!env) return;
    if (env.type !== MessageType.PROMPT) return;
    if (env.id !== current.promptId) return;

    const agentRecvPerfMs = perfNowMs();
    const agentRecvWallMs = wallNowMs();
    current.sendToAgentMs = agentRecvPerfMs - current.sentAtPerfMs;
    if (typeof env.relayTs === "number") {
      const relayWallOnLocalClock = env.relayTs - relayClockOffsetMs;
      current.sendToRelayMs = relayWallOnLocalClock - current.sentAtWallMs;
      current.relayToAgentMs = agentRecvWallMs - relayWallOnLocalClock;
    }

    const decryptedPrompt = await timed(() => openEnvelopeWeb(env, agentKey));
    if (state?.promptId !== current.promptId) return;
    current.agentDecryptMs = decryptedPrompt.ms;

    sendWsFrame(agentSocket, toWsAckFrame({
      messageId: env.id,
      source: agentDeviceId,
      sessionId,
    }));

    const encodedChunk = await timed(() => createEnvelopeWeb(
      agentDeviceId,
      "broadcast",
      sessionId,
      MessageType.STREAM_CHUNK,
      chunkPayload,
      agentKey,
      agentSeq.next(),
    ));
    if (state?.promptId !== current.promptId) return;
    current.agentEncodeChunkMs = encodedChunk.ms;
    sendWsFrame(agentSocket, toWsMessageFrame(encodedChunk.value));

    const endEnvelope = await createEnvelopeWeb(
      agentDeviceId,
      "broadcast",
      sessionId,
      MessageType.STREAM_END,
      "",
      agentKey,
      agentSeq.next(),
    );
    sendWsFrame(agentSocket, toWsMessageFrame(endEnvelope));
  };

  const removeAppAck = onWsAck(appSocket, onAppAck);
  const removeAppMessage = onWsEnvelope(appSocket, onAppMessage);
  const removeAgentMessage = onWsEnvelope(agentSocket, onAgentMessage);

  try {
    const total = warmup + iterations;
    for (let i = 0; i < total; i += 1) {
      chunkPayload = makePayload(`${name}-chunk-${i}`, chunkBytes);
      const promptPayload = makePayload(`${name}-prompt-${i}`, promptBytes);
      const encodedPrompt = await timed(() => createEnvelopeWeb(
        appDeviceId,
        "broadcast",
        sessionId,
        MessageType.PROMPT,
        promptPayload,
        appKey,
        appSeq.next(),
      ));

      const isWarmup = i < warmup;
      await new Promise<void>((resolveFn, rejectFn) => {
        state = {
          promptId: encodedPrompt.value.id,
          sentAtPerfMs: perfNowMs(),
          sentAtWallMs: wallNowMs(),
          appEncodeMs: encodedPrompt.ms,
          chunkDecoded: false,
          endSeen: false,
          done: () => resolveFn(),
          fail: (err) => rejectFn(err),
        };
        state.timer = setTimeout(() => {
          rejectFn(new Error(`${name} 超时: ${encodedPrompt.value.id}`));
        }, timeoutMs);
        sendWsFrame(appSocket, toWsMessageFrame(encodedPrompt.value));
      });

      const current = state as TextIterationState | null;
      if (!current) throw new Error(`${name} 状态丢失`);
      cleanupState();
      if (isWarmup) continue;

      samples.push({
        appEncodeMs: current.appEncodeMs,
        agentDecryptMs: current.agentDecryptMs,
        agentEncodeChunkMs: current.agentEncodeChunkMs,
        appDecryptChunkMs: current.appDecryptChunkMs,
        sendToRelayMs: ensureMetric(current.sendToRelayMs, "sendToRelayMs"),
        relayToAgentMs: ensureMetric(current.relayToAgentMs, "relayToAgentMs"),
        sendToAgentMs: ensureMetric(current.sendToAgentMs, "sendToAgentMs"),
        sendToAckMs: ensureMetric(current.sendToAckMs, "sendToAckMs"),
        sendToFirstChunkMs: ensureMetric(current.sendToFirstChunkMs, "sendToFirstChunkMs"),
        agentChunkToAppMs: ensureMetric(current.agentChunkToAppMs, "agentChunkToAppMs"),
        sendToEndMs: ensureMetric(current.sendToEndMs, "sendToEndMs"),
      });
    }
  } finally {
    cleanupState();
    removeAppAck();
    removeAppMessage();
    removeAgentMessage();
  }

  return {
    name,
    warmup,
    iterations,
    payloadBytes: {
      prompt: promptBytes,
      streamChunk: chunkBytes,
    },
    metrics: {
      appEncodeMs: summarize(toNumberArray(samples.map((s) => s.appEncodeMs))),
      agentDecryptMs: summarize(toNumberArray(samples.map((s) => s.agentDecryptMs))),
      agentEncodeChunkMs: summarize(toNumberArray(samples.map((s) => s.agentEncodeChunkMs))),
      appDecryptChunkMs: summarize(toNumberArray(samples.map((s) => s.appDecryptChunkMs))),
      sendToRelayMs: summarize(toNumberArray(samples.map((s) => s.sendToRelayMs))),
      relayToAgentMs: summarize(toNumberArray(samples.map((s) => s.relayToAgentMs))),
      sendToAgentMs: summarize(toNumberArray(samples.map((s) => s.sendToAgentMs))),
      sendToAckMs: summarize(toNumberArray(samples.map((s) => s.sendToAckMs))),
      sendToFirstChunkMs: summarize(toNumberArray(samples.map((s) => s.sendToFirstChunkMs))),
      agentChunkToAppMs: summarize(toNumberArray(samples.map((s) => s.agentChunkToAppMs))),
      sendToEndMs: summarize(toNumberArray(samples.map((s) => s.sendToEndMs))),
    },
  };
}

async function runBinaryScenario(params: {
  name: string;
  appSocket: WebSocket;
  agentSocket: WebSocket;
  appKey: CryptoKey;
  agentKey: CryptoKey;
  appDeviceId: string;
  agentDeviceId: string;
  sessionId: string;
  warmup: number;
  iterations: number;
  inputBytes: number;
  outputBytes: number;
}): Promise<ScenarioResult> {
  const {
    name,
    appSocket,
    agentSocket,
    appKey,
    agentKey,
    appDeviceId,
    agentDeviceId,
    sessionId,
    warmup,
    iterations,
    inputBytes,
    outputBytes,
  } = params;

  const appSeq = new SeqCounter();
  const agentSeq = new SeqCounter();
  const samples: BinarySample[] = [];
  const timeoutMs = 8_000;
  const ptyId = "bench-pty";

  let state: BinaryIterationState | null = null;
  let outputPayload = makePayload(`${name}-out`, outputBytes);

  const cleanupState = () => {
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state = null;
  };

  const onAppMessage = async (raw: unknown) => {
    const current = state;
    if (!current) return;
    const env = toBinaryEnvelope(raw);
    if (!env) return;
    if (env.type !== MessageType.PTY_OUTPUT) return;
    if (env.ptyId !== ptyId) return;

    const nowPerf = perfNowMs();
    const nowWall = wallNowMs();
    current.sendToEchoMs = nowPerf - current.sentAtPerfMs;
    current.agentToAppMs = nowWall - env.ts;
    const decrypted = await timed(() => openBinaryEnvelopeWeb(env, appKey));
    if (state?.requestId !== current.requestId) return;
    current.appDecryptMs = decrypted.ms;
    if (decrypted.value.length !== outputPayload.length) {
      current.fail?.(new Error("binary output 解密长度不一致"));
      return;
    }
    current.done?.();
  };

  const onAgentMessage = async (raw: unknown) => {
    const current = state;
    if (!current) return;
    const env = toBinaryEnvelope(raw);
    if (!env) return;
    if (env.type !== MessageType.PTY_INPUT) return;
    if (env.id !== current.requestId) return;

    current.sendToAgentMs = perfNowMs() - current.sentAtPerfMs;
    const decrypted = await timed(() => openBinaryEnvelopeWeb(env, agentKey));
    if (state?.requestId !== current.requestId) return;
    current.agentDecryptMs = decrypted.ms;

    const encodedOutput = await timed(() => createBinaryEnvelopeWeb(
      agentDeviceId,
      "broadcast",
      sessionId,
      MessageType.PTY_OUTPUT,
      outputPayload,
      agentKey,
      agentSeq.next(),
      ptyId,
    ));
    if (state?.requestId !== current.requestId) return;
    current.agentEncodeMs = encodedOutput.ms;
    sendWsFrame(agentSocket, toWsMessageFrame(encodedOutput.value));
  };

  const removeAppMessage = onWsEnvelope(appSocket, onAppMessage);
  const removeAgentMessage = onWsEnvelope(agentSocket, onAgentMessage);

  try {
    const total = warmup + iterations;
    for (let i = 0; i < total; i += 1) {
      const isWarmup = i < warmup;
      const inputPayload = makePayload(`${name}-in-${i}`, inputBytes);
      outputPayload = makePayload(`${name}-out-${i}`, outputBytes);

      const encodedInput = await timed(() => createBinaryEnvelopeWeb(
        appDeviceId,
        "broadcast",
        sessionId,
        MessageType.PTY_INPUT,
        inputPayload,
        appKey,
        appSeq.next(),
        ptyId,
      ));

      await new Promise<void>((resolveFn, rejectFn) => {
        state = {
          requestId: encodedInput.value.id,
          sentAtPerfMs: perfNowMs(),
          sentAtWallMs: wallNowMs(),
          appEncodeMs: encodedInput.ms,
          done: () => resolveFn(),
          fail: (err) => rejectFn(err),
        };
        state.timer = setTimeout(() => {
          rejectFn(new Error(`${name} 超时: ${encodedInput.value.id}`));
        }, timeoutMs);
        sendWsFrame(appSocket, toWsMessageFrame(encodedInput.value));
      });

      const current = state as BinaryIterationState | null;
      if (!current) throw new Error(`${name} 状态丢失`);
      cleanupState();
      if (isWarmup) continue;

      samples.push({
        appEncodeMs: current.appEncodeMs,
        agentDecryptMs: current.agentDecryptMs,
        agentEncodeMs: current.agentEncodeMs,
        appDecryptMs: current.appDecryptMs,
        sendToAgentMs: ensureMetric(current.sendToAgentMs, "sendToAgentMs"),
        sendToEchoMs: ensureMetric(current.sendToEchoMs, "sendToEchoMs"),
        agentToAppMs: ensureMetric(current.agentToAppMs, "agentToAppMs"),
      });
    }
  } finally {
    cleanupState();
    removeAppMessage();
    removeAgentMessage();
  }

  return {
    name,
    warmup,
    iterations,
    payloadBytes: {
      ptyInput: inputBytes,
      ptyOutput: outputBytes,
    },
    metrics: {
      appEncodeMs: summarize(toNumberArray(samples.map((s) => s.appEncodeMs))),
      agentDecryptMs: summarize(toNumberArray(samples.map((s) => s.agentDecryptMs))),
      agentEncodeMs: summarize(toNumberArray(samples.map((s) => s.agentEncodeMs))),
      appDecryptMs: summarize(toNumberArray(samples.map((s) => s.appDecryptMs))),
      sendToAgentMs: summarize(toNumberArray(samples.map((s) => s.sendToAgentMs))),
      sendToEchoMs: summarize(toNumberArray(samples.map((s) => s.sendToEchoMs))),
      agentToAppMs: summarize(toNumberArray(samples.map((s) => s.agentToAppMs))),
    },
  };
}

function buildMarkdownReport(result: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push("# Yuanio 通信延迟基线报告");
  lines.push("");
  lines.push(`- 生成时间: ${result.generatedAt}`);
  lines.push(`- Server: ${result.environment.serverUrl}`);
  lines.push(`- OS/Arch: ${result.environment.os}/${result.environment.arch}`);
  lines.push(`- Bun: ${result.environment.bunVersion}`);
  lines.push(`- Node: ${result.environment.nodeVersion}`);
  lines.push(`- 自动拉起 Relay: ${result.environment.autoRelay ? "是" : "否"}`);
  lines.push(`- Relay 时钟偏移估计: ${fmtMs(result.environment.relayClockOffsetMs)} ms (RTT ${fmtMs(result.environment.relayClockRttMs)} ms, samples=${result.environment.relayClockSamples})`);
  lines.push(`- Relay Event Loop Lag(开始): p50=${fmtMs(result.environment.relayEventLoopLagStart.p50)} / p95=${fmtMs(result.environment.relayEventLoopLagStart.p95)} / max=${fmtMs(result.environment.relayEventLoopLagStart.max)} ms`);
  lines.push(`- Relay Event Loop Lag(结束): p50=${fmtMs(result.environment.relayEventLoopLagEnd.p50)} / p95=${fmtMs(result.environment.relayEventLoopLagEnd.p95)} / max=${fmtMs(result.environment.relayEventLoopLagEnd.max)} ms`);
  lines.push("");
  lines.push("## 握手阶段");
  lines.push("");
  lines.push("| 指标 | 耗时(ms) |");
  lines.push("|---|---:|");
  lines.push(`| pair/create | ${fmtMs(result.handshake.pairCreateMs)} |`);
  lines.push(`| pair/join | ${fmtMs(result.handshake.pairJoinMs)} |`);
  lines.push(`| derive key (agent) | ${fmtMs(result.handshake.deriveAgentKeyMs)} |`);
  lines.push(`| derive key (app) | ${fmtMs(result.handshake.deriveAppKeyMs)} |`);
  lines.push(`| socket connect (agent) | ${fmtMs(result.handshake.agentConnectMs)} |`);
  lines.push(`| socket connect (app) | ${fmtMs(result.handshake.appConnectMs)} |`);

  for (const scenario of result.scenarios) {
    lines.push("");
    lines.push(`## 场景: ${scenario.name}`);
    lines.push("");
    lines.push(`- Warmup: ${scenario.warmup}`);
    lines.push(`- Iterations: ${scenario.iterations}`);
    lines.push(`- Payload: ${Object.entries(scenario.payloadBytes).map(([k, v]) => `${k}=${v}B`).join(", ")}`);
    lines.push("");
    lines.push("| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const [metric, summary] of Object.entries(scenario.metrics)) {
      lines.push(`| ${metric} | ${fmtMs(summary.p50)} | ${fmtMs(summary.p95)} | ${fmtMs(summary.mean)} | ${fmtMs(summary.max)} | ${summary.count} |`);
    }
  }

  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push("1. 本报告是通信链路基准，主要用于后续优化前后对比。");
  lines.push("2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。");
  lines.push("3. 二进制链路覆盖 pty_input/pty_output。");
  lines.push("4. 详细原始结果见同目录 JSON 文件。");
  lines.push("");
  return lines.join("\n");
}

function scenarioToJsonObject(result: ScenarioResult): JsonObject {
  const metricObj: JsonObject = {};
  for (const [key, value] of Object.entries(result.metrics)) {
    metricObj[key] = {
      count: value.count,
      min: value.min,
      max: value.max,
      mean: value.mean,
      p50: value.p50,
      p90: value.p90,
      p95: value.p95,
      p99: value.p99,
    };
  }
  const payloadObj: JsonObject = {};
  for (const [k, v] of Object.entries(result.payloadBytes)) payloadObj[k] = v;
  return {
    name: result.name,
    warmup: result.warmup,
    iterations: result.iterations,
    payloadBytes: payloadObj,
    metrics: metricObj,
  };
}

async function main(): Promise<void> {
  let relayProcess: Bun.Subprocess | null = null;
  let agentSocket: WebSocket | null = null;
  let appSocket: WebSocket | null = null;

  try {
    let relayHealthStart = await fetchRelayHealth(serverUrl);
    if (!relayHealthStart && autoRelay) {
      console.log(`[baseline] 启动 relay: ${serverUrl}`);
      const relayPort = resolveServerPort(serverUrl);
      relayProcess = Bun.spawn(["bun", "run", "packages/relay-server/src/index.ts"], {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PORT: String(relayPort) },
      });
      relayHealthStart = await waitRelayHealthy(serverUrl, 15_000);
    } else if (!relayHealthStart) {
      throw new Error(`relay 不可用: ${serverUrl}`);
    }

    const relayClock = await estimateRelayClockOffset(serverUrl, 7);
    console.log(
      `[baseline] relay clock offset=${fmtMs(relayClock.offsetMs)}ms rtt=${fmtMs(relayClock.rttMs)}ms samples=${relayClock.samples}`,
    );

    const agentKeyPair: WebKeyPair = await generateWebKeyPair();
    const appKeyPair: WebKeyPair = await generateWebKeyPair();

    const pairCreateTimed = await timed(() => createPair(serverUrl, agentKeyPair.publicKey));
    const pair = pairCreateTimed.value;
    const pairJoinTimed = await timed(() => joinPair(serverUrl, pair.pairingCode, appKeyPair.publicKey));
    const joined = pairJoinTimed.value;

    const deriveAgent = await timed(() => deriveAesGcmKey({
      privateKey: agentKeyPair.privateKey,
      publicKey: appKeyPair.publicKey,
      salt: pair.sessionId,
    }));
    const deriveApp = await timed(() => deriveAesGcmKey({
      privateKey: appKeyPair.privateKey,
      publicKey: joined.agentPublicKey,
      salt: joined.sessionId,
    }));

    const connectedAgent = await connectSocket("agent", serverUrl, pair.sessionToken);
    const connectedApp = await connectSocket("app", serverUrl, joined.sessionToken);
    agentSocket = connectedAgent.socket;
    appSocket = connectedApp.socket;

    const textCases: TextCaseConfig[] = [
      { name: "text-small", warmup, iterations, promptBytes: 128, chunkBytes: 256 },
      { name: "text-large", warmup, iterations, promptBytes: 256, chunkBytes: 8 * 1024 },
    ];
    const binaryCases: BinaryCaseConfig[] = [
      { name: "binary-small", warmup, iterations, inputBytes: 128, outputBytes: 256 },
      { name: "binary-large", warmup, iterations, inputBytes: 256, outputBytes: 8 * 1024 },
    ];

    const scenarios: ScenarioResult[] = [];

    for (const tc of textCases) {
      console.log(`[baseline] 运行场景: ${tc.name}`);
      const result = await runTextScenario({
        name: tc.name,
        appSocket,
        agentSocket,
        appKey: deriveApp.value,
        agentKey: deriveAgent.value,
        appDeviceId: joined.deviceId,
        agentDeviceId: pair.deviceId,
        sessionId: pair.sessionId,
        warmup: tc.warmup,
        iterations: tc.iterations,
        promptBytes: tc.promptBytes,
        chunkBytes: tc.chunkBytes,
        relayClockOffsetMs: relayClock.offsetMs,
      });
      scenarios.push(result);
    }

    for (const bc of binaryCases) {
      console.log(`[baseline] 运行场景: ${bc.name}`);
      const result = await runBinaryScenario({
        name: bc.name,
        appSocket,
        agentSocket,
        appKey: deriveApp.value,
        agentKey: deriveAgent.value,
        appDeviceId: joined.deviceId,
        agentDeviceId: pair.deviceId,
        sessionId: pair.sessionId,
        warmup: bc.warmup,
        iterations: bc.iterations,
        inputBytes: bc.inputBytes,
        outputBytes: bc.outputBytes,
      });
      scenarios.push(result);
    }

    const relayHealthEnd = await fetchRelayHealth(serverUrl);
    const relayEventLoopLagStart = relayHealthStart?.eventLoopLagMs ?? emptyEventLoopLagSummary();
    const relayEventLoopLagEnd = relayHealthEnd?.eventLoopLagMs ?? emptyEventLoopLagSummary();

    const benchmarkResult: BenchmarkResult = {
      generatedAt: new Date().toISOString(),
      environment: {
        os: process.platform,
        arch: process.arch,
        bunVersion: Bun.version,
        nodeVersion: process.version,
        serverUrl,
        autoRelay,
        relayClockOffsetMs: relayClock.offsetMs,
        relayClockRttMs: relayClock.rttMs,
        relayClockSamples: relayClock.samples,
        relayEventLoopLagStart,
        relayEventLoopLagEnd,
      },
      handshake: {
        pairCreateMs: pairCreateTimed.ms,
        pairJoinMs: pairJoinTimed.ms,
        deriveAgentKeyMs: deriveAgent.ms,
        deriveAppKeyMs: deriveApp.ms,
        agentConnectMs: connectedAgent.connectMs,
        appConnectMs: connectedApp.connectMs,
      },
      scenarios,
    };

    const jsonObject: JsonObject = {
      generatedAt: benchmarkResult.generatedAt,
      environment: {
        os: benchmarkResult.environment.os,
        arch: benchmarkResult.environment.arch,
        bunVersion: benchmarkResult.environment.bunVersion,
        nodeVersion: benchmarkResult.environment.nodeVersion,
        serverUrl: benchmarkResult.environment.serverUrl,
        autoRelay: benchmarkResult.environment.autoRelay,
        relayClockOffsetMs: benchmarkResult.environment.relayClockOffsetMs,
        relayClockRttMs: benchmarkResult.environment.relayClockRttMs,
        relayClockSamples: benchmarkResult.environment.relayClockSamples,
        relayEventLoopLagStart: {
          count: benchmarkResult.environment.relayEventLoopLagStart.count,
          p50: benchmarkResult.environment.relayEventLoopLagStart.p50,
          p95: benchmarkResult.environment.relayEventLoopLagStart.p95,
          max: benchmarkResult.environment.relayEventLoopLagStart.max,
          last: benchmarkResult.environment.relayEventLoopLagStart.last,
        },
        relayEventLoopLagEnd: {
          count: benchmarkResult.environment.relayEventLoopLagEnd.count,
          p50: benchmarkResult.environment.relayEventLoopLagEnd.p50,
          p95: benchmarkResult.environment.relayEventLoopLagEnd.p95,
          max: benchmarkResult.environment.relayEventLoopLagEnd.max,
          last: benchmarkResult.environment.relayEventLoopLagEnd.last,
        },
      },
      handshake: {
        pairCreateMs: benchmarkResult.handshake.pairCreateMs,
        pairJoinMs: benchmarkResult.handshake.pairJoinMs,
        deriveAgentKeyMs: benchmarkResult.handshake.deriveAgentKeyMs,
        deriveAppKeyMs: benchmarkResult.handshake.deriveAppKeyMs,
        agentConnectMs: benchmarkResult.handshake.agentConnectMs,
        appConnectMs: benchmarkResult.handshake.appConnectMs,
      },
      scenarios: benchmarkResult.scenarios.map((s) => scenarioToJsonObject(s)),
    };

    const mdText = buildMarkdownReport(benchmarkResult);
    const jsonText = JSON.stringify(jsonObject, null, 2);
    const mdPath = resolve(projectRoot, mdOutputPath);
    const jsonPath = resolve(projectRoot, jsonOutputPath);

    await mkdir(dirname(mdPath), { recursive: true });
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(mdPath, mdText, "utf-8");
    await writeFile(jsonPath, jsonText, "utf-8");

    console.log(`[baseline] 已写入: ${mdPath}`);
    console.log(`[baseline] 已写入: ${jsonPath}`);
  } finally {
    if (appSocket) {
      appSocket.removeAllListeners();
      appSocket.close();
    }
    if (agentSocket) {
      agentSocket.removeAllListeners();
      agentSocket.close();
    }
    if (relayProcess) {
      relayProcess.kill("SIGTERM");
      await relayProcess.exited;
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[baseline] 失败: ${message}`);
  process.exit(1);
});

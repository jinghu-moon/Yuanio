import {
  MessageType,
  SeqCounter,
  createEnvelopeWeb,
  deriveAesGcmKey,
  generateWebKeyPair,
  openEnvelopeWeb,
  type Envelope,
  type PermissionMode,
  type WebKeyPair,
} from "@yuanio/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  connectRelayWs,
  decodeWsData,
  isTextEnvelope,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsMessageFrame,
  waitForWsOpen,
} from "./relay-options";
import type { AgentType } from "./spawn";
import { RelayClient } from "./relay-client";
import { setupRemoteMode } from "./remote";

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
  appConnectMs: number;
}

interface AgentE2ESample {
  appEncodeMs: number;
  sendToAckFirstMs?: number;
  sendToAckWorkingMs?: number;
  sendToAckOkMs?: number;
  sendToFirstThinkingMs?: number;
  sendToFirstChunkMs?: number;
  sendToFirstFileDiffMs?: number;
  sendToEndMs?: number;
  thinkingCount: number;
  chunkCount: number;
  chunkChars: number;
  fileDiffCount: number;
}

interface FileDiffSample {
  path: string;
  action: "created" | "modified" | "deleted";
  diffPreview: string;
}

interface ScenarioResult {
  name: string;
  warmup: number;
  iterations: number;
  payloadBytes: Record<string, number>;
  metrics: Record<string, QuantileSummary>;
  fileDiffSamples: FileDiffSample[];
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
    agent: AgentType;
    relayClockOffsetMs: number;
    relayClockRttMs: number;
    relayClockSamples: number;
    relayEventLoopLagStart: RelayEventLoopLagSummary;
    relayEventLoopLagEnd: RelayEventLoopLagSummary;
    permissionMode: PermissionMode;
  };
  handshake: HandshakeMetrics;
  scenarios: ScenarioResult[];
}

interface IterationState {
  promptId: string;
  sentAtPerfMs: number;
  sentAtWallMs: number;
  appEncodeMs: number;
  ackFirstAtMs?: number;
  ackWorkingAtMs?: number;
  ackOkAtMs?: number;
  firstThinkingAtMs?: number;
  firstChunkAtMs?: number;
  firstFileDiffAtMs?: number;
  endAtMs?: number;
  thinkingCount: number;
  chunkCount: number;
  chunkChars: number;
  fileDiffCount: number;
  fileDiffSamples: FileDiffSample[];
  terminalReason?: string;
  done?: () => void;
  fail?: (err: Error) => void;
  timer?: Timer;
  endAckWaitTimer?: Timer;
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

function argInt(name: string, fallback: number, allowZero = false): number {
  const raw = arg(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  if (allowZero) {
    if (value < 0) return fallback;
    return value;
  }
  if (value <= 0) return fallback;
  return value;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function resolveAgent(raw: string): AgentType {
  if (raw === "claude" || raw === "gemini") return raw;
  return "codex";
}

function resolvePermissionMode(raw: string): PermissionMode {
  if (raw === "acceptEdits" || raw === "yolo" || raw === "readonly") return raw;
  return "default";
}

const serverUrl = arg("--server", "http://127.0.0.1:3000");
const warmup = argInt("--warmup", 1, true);
const iterations = argInt("--iterations", 4);
const timeoutMs = argInt("--timeout-ms", 120_000);
const autoRelay = !hasFlag("--no-auto-relay");
const mdOutputPath = arg("--out", "docs/latency-agent-e2e.md");
const jsonOutputPath = arg("--json-out", "docs/latency-agent-e2e.json");
const agent = resolveAgent(arg("--agent", "codex"));
const promptBase = arg("--prompt", "请直接回复：OK。不要调用工具。");
const permissionMode = resolvePermissionMode(arg("--permission-mode", "default"));

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

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toFileDiffSample(rawPayload: string): FileDiffSample | null {
  const parsed = safeJsonParse(rawPayload);
  if (!parsed) return null;
  const path = typeof parsed.path === "string" && parsed.path.length > 0 ? parsed.path : "unknown";
  const actionRaw = typeof parsed.action === "string" ? parsed.action : "modified";
  const action = actionRaw === "created" || actionRaw === "deleted" ? actionRaw : "modified";
  const diff = typeof parsed.diff === "string" ? parsed.diff : "";
  const lines = diff.replace(/\r\n/g, "\n").split("\n").slice(0, 6).join("\n");
  const diffPreview = lines.length > 320 ? `${lines.slice(0, 320)}...` : lines;
  return { path, action, diffPreview };
}

function escapeMdCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "\\n");
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

async function waitRelayHealthy(url: string, timeoutMsValue: number): Promise<RelayHealthSnapshot> {
  const deadline = Date.now() + timeoutMsValue;
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

async function postPairingWithRetry<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let lastError: string = "unknown";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      return await response.json() as T;
    }
    const text = await response.text();
    lastError = `${response.status} ${text}`;
    if (response.status === 429 && attempt < 3) {
      let retryAfterSec = 60;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.retryAfter === "number" && parsed.retryAfter > 0) {
          retryAfterSec = Math.ceil(parsed.retryAfter);
        }
      } catch {}
      await sleep((retryAfterSec + 2) * 1000);
      continue;
    }
    break;
  }
  throw new Error(`配对请求失败: ${url} -> ${lastError}`);
}

async function createPair(server: string, publicKey: string): Promise<PairCreateResponse> {
  return postPairingWithRetry<PairCreateResponse>(`${server}/api/v1/pair/create`, { publicKey });
}

async function joinPair(server: string, code: string, publicKey: string): Promise<PairJoinResponse> {
  return postPairingWithRetry<PairJoinResponse>(`${server}/api/v1/pair/join`, { code, publicKey });
}

async function connectSocket(server: string, sessionToken: string): Promise<ConnectedSocket> {
  const start = perfNowMs();
  const socket = connectRelayWs(server, sessionToken);
  await waitForWsOpen(socket, 20_000);
  return { socket, connectMs: perfNowMs() - start };
}

async function waitRelayClientConnected(relay: RelayClient, timeoutMsValue: number): Promise<void> {
  const deadline = Date.now() + timeoutMsValue;
  while (Date.now() < deadline) {
    if (relay.connected) return;
    await sleep(100);
  }
  throw new Error("agent relay client 连接超时");
}

function onWsEnvelope(
  socket: WebSocket,
  handler: (env: Envelope) => void,
): () => void {
  const onMessage = (data: any) => {
    const parsed = parseWsFrame(decodeWsData(data));
    if (!parsed.ok) return;
    const frame = parsed.frame as { type: string; data?: unknown };
    if (frame.type !== "message") return;
    const env = normalizeEnvelopePayload(frame.data as Envelope);
    if (!isTextEnvelope(env)) return;
    handler(env);
  };
  socket.on("message", onMessage);
  return () => socket.off("message", onMessage);
}

function onWsAck(
  socket: WebSocket,
  handler: (ack: { messageId?: string; state?: string }) => void,
): () => void {
  const onMessage = (data: any) => {
    const parsed = parseWsFrame(decodeWsData(data));
    if (!parsed.ok) return;
    const frame = parsed.frame as { type: string; data?: unknown };
    if (frame.type !== "ack") return;
    handler(frame.data as { messageId?: string; state?: string });
  };
  socket.on("message", onMessage);
  return () => socket.off("message", onMessage);
}

async function runAgentScenario(params: {
  appSocket: WebSocket;
  appKey: CryptoKey;
  appDeviceId: string;
  sessionId: string;
  warmup: number;
  iterations: number;
  promptBaseText: string;
  timeoutMsValue: number;
}): Promise<ScenarioResult> {
  const {
    appSocket,
    appKey,
    appDeviceId,
    sessionId,
    warmup: warmupCount,
    iterations: iterationsCount,
    promptBaseText,
    timeoutMsValue,
  } = params;

  const seq = new SeqCounter();
  const samples: AgentE2ESample[] = [];
  const fileDiffSamples: FileDiffSample[] = [];
  let state: IterationState | null = null;

  const cleanupState = () => {
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.endAckWaitTimer) clearTimeout(state.endAckWaitTimer);
    state = null;
  };

  const maybeDone = (current: IterationState) => {
    if (!current.done || current.endAtMs === undefined) return;
    if (current.ackOkAtMs !== undefined) {
      current.done();
      return;
    }
    if (!current.endAckWaitTimer) {
      current.endAckWaitTimer = setTimeout(() => current.done?.(), 1500);
    }
  };

  const onAppAck = (obj: { messageId?: string; state?: string; reason?: string }) => {
    const current = state;
    if (!current) return;
    if (obj.messageId !== current.promptId) return;
    const now = perfNowMs();
    const ackState = typeof obj.state === "string" ? obj.state : "ok";
    if (ackState !== "retry_after" && current.ackFirstAtMs === undefined) {
      current.ackFirstAtMs = now;
    }
    if (ackState === "terminal") {
      if (current.endAtMs === undefined) current.endAtMs = now;
      current.terminalReason = typeof obj.reason === "string" ? obj.reason : undefined;
      current.done?.();
      return;
    }
    if (ackState === "working" && current.ackWorkingAtMs === undefined) {
      current.ackWorkingAtMs = now;
    }
    if (ackState === "ok" && current.ackOkAtMs === undefined) {
      current.ackOkAtMs = now;
    }
    maybeDone(current);
  };

  const onAppMessage = async (raw: unknown) => {
    const current = state;
    if (!current) return;
    const env = toEnvelope(raw);
    if (!env) return;
    const now = perfNowMs();

    if (env.type === MessageType.THINKING) {
      current.thinkingCount += 1;
      if (current.firstThinkingAtMs === undefined) current.firstThinkingAtMs = now;
      return;
    }

    if (env.type === MessageType.STREAM_CHUNK) {
      if (current.firstChunkAtMs === undefined) current.firstChunkAtMs = now;
      current.chunkCount += 1;
      const decrypted = await openEnvelopeWeb(env, appKey);
      current.chunkChars += decrypted.length;
      return;
    }

    if (env.type === MessageType.STREAM_END) {
      current.endAtMs = now;
      maybeDone(current);
      return;
    }

    if (env.type === MessageType.FILE_DIFF) {
      current.fileDiffCount += 1;
      if (current.firstFileDiffAtMs === undefined) current.firstFileDiffAtMs = now;
      const decrypted = await openEnvelopeWeb(env, appKey);
      const sample = toFileDiffSample(decrypted);
      if (sample) current.fileDiffSamples.push(sample);
    }
  };

  const removeAppAck = onWsAck(appSocket, onAppAck);
  const removeAppMessage = onWsEnvelope(appSocket, onAppMessage);

  try {
    const total = warmupCount + iterationsCount;
    for (let i = 0; i < total; i += 1) {
      const isWarmup = i < warmupCount;
      const promptText = `${promptBaseText}\n[bench-${i}]`;

      const encodedPrompt = await timed(() => createEnvelopeWeb(
        appDeviceId,
        "broadcast",
        sessionId,
        MessageType.PROMPT,
        promptText,
        appKey,
        seq.next(),
      ));

      const completed = await new Promise<IterationState>((resolveFn, rejectFn) => {
        const current: IterationState = {
          promptId: encodedPrompt.value.id,
          sentAtPerfMs: perfNowMs(),
          sentAtWallMs: wallNowMs(),
          appEncodeMs: encodedPrompt.ms,
          thinkingCount: 0,
          chunkCount: 0,
          chunkChars: 0,
          fileDiffCount: 0,
          fileDiffSamples: [],
          done: () => resolveFn({ ...current }),
          fail: (err) => rejectFn(err),
        };
        current.timer = setTimeout(() => {
          rejectFn(new Error(`agent-e2e 超时: ${current.promptId}`));
        }, timeoutMsValue);
        state = current;
        sendWsFrame(appSocket, toWsMessageFrame(encodedPrompt.value));
      });
      cleanupState();
      if (isWarmup) continue;

      for (const sample of completed.fileDiffSamples) {
        if (fileDiffSamples.length >= 12) break;
        const exists = fileDiffSamples.some(
          (x) => x.path === sample.path && x.action === sample.action && x.diffPreview === sample.diffPreview,
        );
        if (!exists) fileDiffSamples.push(sample);
      }

      samples.push({
        appEncodeMs: completed.appEncodeMs,
        sendToAckFirstMs: completed.ackFirstAtMs !== undefined ? completed.ackFirstAtMs - completed.sentAtPerfMs : undefined,
        sendToAckWorkingMs: completed.ackWorkingAtMs !== undefined ? completed.ackWorkingAtMs - completed.sentAtPerfMs : undefined,
        sendToAckOkMs: completed.ackOkAtMs !== undefined ? completed.ackOkAtMs - completed.sentAtPerfMs : undefined,
        sendToFirstThinkingMs: completed.firstThinkingAtMs !== undefined ? completed.firstThinkingAtMs - completed.sentAtPerfMs : undefined,
        sendToFirstChunkMs: completed.firstChunkAtMs !== undefined ? completed.firstChunkAtMs - completed.sentAtPerfMs : undefined,
        sendToFirstFileDiffMs: completed.firstFileDiffAtMs !== undefined ? completed.firstFileDiffAtMs - completed.sentAtPerfMs : undefined,
        sendToEndMs: completed.endAtMs !== undefined ? completed.endAtMs - completed.sentAtPerfMs : undefined,
        thinkingCount: completed.thinkingCount,
        chunkCount: completed.chunkCount,
        chunkChars: completed.chunkChars,
        fileDiffCount: completed.fileDiffCount,
      });
    }
  } finally {
    cleanupState();
    removeAppAck();
    removeAppMessage();
  }

  const promptBytes = Buffer.byteLength(`${promptBaseText}\n[bench-xx]`);

  return {
    name: "agent-e2e",
    warmup: warmupCount,
    iterations: iterationsCount,
    payloadBytes: {
      prompt: promptBytes,
    },
    metrics: {
      appEncodeMs: summarize(toNumberArray(samples.map((s) => s.appEncodeMs))),
      sendToAckFirstMs: summarize(toNumberArray(samples.map((s) => s.sendToAckFirstMs))),
      sendToAckWorkingMs: summarize(toNumberArray(samples.map((s) => s.sendToAckWorkingMs))),
      sendToAckOkMs: summarize(toNumberArray(samples.map((s) => s.sendToAckOkMs))),
      sendToFirstThinkingMs: summarize(toNumberArray(samples.map((s) => s.sendToFirstThinkingMs))),
      sendToFirstChunkMs: summarize(toNumberArray(samples.map((s) => s.sendToFirstChunkMs))),
      sendToFirstFileDiffMs: summarize(toNumberArray(samples.map((s) => s.sendToFirstFileDiffMs))),
      sendToEndMs: summarize(toNumberArray(samples.map((s) => s.sendToEndMs))),
      thinkingCount: summarize(toNumberArray(samples.map((s) => s.thinkingCount))),
      chunkCount: summarize(toNumberArray(samples.map((s) => s.chunkCount))),
      chunkChars: summarize(toNumberArray(samples.map((s) => s.chunkChars))),
      fileDiffCount: summarize(toNumberArray(samples.map((s) => s.fileDiffCount))),
    },
    fileDiffSamples,
  };
}

function buildMarkdownReport(result: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push("# Yuanio 真实 Agent 端到端延迟基线");
  lines.push("");
  lines.push(`- 生成时间: ${result.generatedAt}`);
  lines.push(`- Agent: ${result.environment.agent}`);
  lines.push(`- PermissionMode: ${result.environment.permissionMode}`);
  lines.push(`- Server: ${result.environment.serverUrl}`);
  lines.push(`- Relay 偏移估算: ${fmtMs(result.environment.relayClockOffsetMs)}ms (RTT=${fmtMs(result.environment.relayClockRttMs)}ms, 样本=${result.environment.relayClockSamples})`);
  lines.push("");
  lines.push("## 握手开销");
  lines.push("");
  lines.push("| 指标 | 毫秒 |");
  lines.push("|---|---:|");
  lines.push(`| pairCreateMs | ${fmtMs(result.handshake.pairCreateMs)} |`);
  lines.push(`| pairJoinMs | ${fmtMs(result.handshake.pairJoinMs)} |`);
  lines.push(`| deriveAgentKeyMs | ${fmtMs(result.handshake.deriveAgentKeyMs)} |`);
  lines.push(`| deriveAppKeyMs | ${fmtMs(result.handshake.deriveAppKeyMs)} |`);
  lines.push(`| appConnectMs | ${fmtMs(result.handshake.appConnectMs)} |`);

  for (const scenario of result.scenarios) {
    lines.push("");
    lines.push(`## 场景: ${scenario.name}`);
    lines.push("");
    lines.push(`- Warmup: ${scenario.warmup}`);
    lines.push(`- Iterations: ${scenario.iterations}`);
    const payload = Object.entries(scenario.payloadBytes).map(([k, v]) => `${k}=${v}B`).join(", ");
    lines.push(`- Payload: ${payload}`);
    lines.push("");
    lines.push("| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const [name, metric] of Object.entries(scenario.metrics)) {
      lines.push(`| ${name} | ${fmtMs(metric.p50)} | ${fmtMs(metric.p95)} | ${fmtMs(metric.mean)} | ${fmtMs(metric.max)} | ${fmtMs(metric.count)} |`);
    }
    lines.push("");
    lines.push("### FILE_DIFF 样本");
    lines.push("");
    if (scenario.fileDiffSamples.length === 0) {
      lines.push("- 未捕获到 file_diff 事件");
    } else {
      lines.push("| path | action | diff preview |");
      lines.push("|---|---|---|");
      for (const sample of scenario.fileDiffSamples) {
        lines.push(`| ${escapeMdCell(sample.path)} | ${sample.action} | ${escapeMdCell(sample.diffPreview)} |`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
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
    fileDiffSamples: result.fileDiffSamples.map((sample) => ({
      path: sample.path,
      action: sample.action,
      diffPreview: sample.diffPreview,
    })),
  };
}

async function main(): Promise<void> {
  let relayProcess: Bun.Subprocess | null = null;
  let appSocket: WebSocket | null = null;
  let relayClient: RelayClient | null = null;

  try {
    let relayHealthStart = await fetchRelayHealth(serverUrl);
    if (!relayHealthStart && autoRelay) {
      console.log(`[agent-e2e] 启动 relay: ${serverUrl}`);
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
      `[agent-e2e] relay clock offset=${fmtMs(relayClock.offsetMs)}ms rtt=${fmtMs(relayClock.rttMs)}ms samples=${relayClock.samples}`,
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

    relayClient = new RelayClient(serverUrl, pair.sessionToken);
    await waitRelayClientConnected(relayClient, 20_000);

    await setupRemoteMode(
      relayClient,
      deriveAgent.value,
      pair.deviceId,
      pair.sessionId,
      "broadcast",
      serverUrl,
      pair.sessionToken,
    );

    const connectedApp = await connectSocket(serverUrl, joined.sessionToken);
    appSocket = connectedApp.socket;

    const appSeq = new SeqCounter();
    const switchPayload = JSON.stringify({ agent });
    const switchEnvelope = await createEnvelopeWeb(
      joined.deviceId,
      "broadcast",
      joined.sessionId,
      MessageType.NEW_SESSION,
      switchPayload,
      deriveApp.value,
      appSeq.next(),
    );
    sendWsFrame(appSocket, toWsMessageFrame(switchEnvelope));
    await sleep(400);

    const permissionPayload = JSON.stringify({ mode: permissionMode });
    const permissionEnvelope = await createEnvelopeWeb(
      joined.deviceId,
      "broadcast",
      joined.sessionId,
      MessageType.PERMISSION_MODE,
      permissionPayload,
      deriveApp.value,
      appSeq.next(),
    );
    sendWsFrame(appSocket, toWsMessageFrame(permissionEnvelope));
    await sleep(200);

    console.log(`[agent-e2e] 运行场景: agent-e2e (agent=${agent})`);
    const scenario = await runAgentScenario({
      appSocket,
      appKey: deriveApp.value,
      appDeviceId: joined.deviceId,
      sessionId: joined.sessionId,
      warmup,
      iterations,
      promptBaseText: promptBase,
      timeoutMsValue: timeoutMs,
    });

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
        agent,
        relayClockOffsetMs: relayClock.offsetMs,
        relayClockRttMs: relayClock.rttMs,
        relayClockSamples: relayClock.samples,
        relayEventLoopLagStart,
        relayEventLoopLagEnd,
        permissionMode,
      },
      handshake: {
        pairCreateMs: pairCreateTimed.ms,
        pairJoinMs: pairJoinTimed.ms,
        deriveAgentKeyMs: deriveAgent.ms,
        deriveAppKeyMs: deriveApp.ms,
        appConnectMs: connectedApp.connectMs,
      },
      scenarios: [scenario],
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
        agent: benchmarkResult.environment.agent,
        relayClockOffsetMs: benchmarkResult.environment.relayClockOffsetMs,
        relayClockRttMs: benchmarkResult.environment.relayClockRttMs,
        relayClockSamples: benchmarkResult.environment.relayClockSamples,
        permissionMode: benchmarkResult.environment.permissionMode,
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

    console.log(`[agent-e2e] 已写入: ${mdPath}`);
    console.log(`[agent-e2e] 已写入: ${jsonPath}`);
  } finally {
    if (appSocket) {
      appSocket.removeAllListeners();
      appSocket.close();
    }
    if (relayClient) {
      relayClient.disconnect();
    }
    if (relayProcess) {
      relayProcess.kill("SIGTERM");
      await relayProcess.exited;
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[agent-e2e] 失败: ${message}`);
    process.exit(1);
  });

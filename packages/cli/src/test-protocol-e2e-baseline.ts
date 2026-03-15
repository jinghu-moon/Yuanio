import {
  MessageType,
  PROTOCOL_VERSION,
  SeqCounter,
  createEnvelope,
  deriveSharedKey,
  generateKeyPair,
  openEnvelope,
  type AckMessage,
  type Envelope,
} from "@yuanio/shared";
import { WebSocket } from "ws";
import {
  connectRelayWs,
  decodeWsData,
  isTextEnvelope,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsAckFrame,
  toWsMessageFrame,
  waitForWsOpen,
} from "./relay-options";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PairCreateResponse {
  pairingCode: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
  protocolVersion?: string;
}

interface PairJoinResponse {
  agentPublicKey: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
  protocolVersion?: string;
}

interface HealthResponse {
  ok?: boolean;
  status?: string;
}

interface MessagesResponseRow {
  cursor: number;
  id: string;
  session_id: string;
  source: string;
  target: string;
  type: MessageType;
  seq: number;
  ts: number;
  payload: string;
}

interface MessagesResponse {
  messages: MessagesResponseRow[];
  count: number;
  nextCursor: number;
}

interface QueuePendingResponseRow {
  id: string;
  session_id: string;
  source: string;
  target: string;
  type: MessageType;
  seq: number;
  ts: number;
  payload: string;
}

interface QueuePendingResponse {
  messages: QueuePendingResponseRow[];
  count: number;
}

interface StepResult {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  detail?: string;
}

interface ProtocolE2EBaselineResult {
  status: "pass" | "fail";
  generatedAt: string;
  serverUrl: string;
  autoRelay: boolean;
  timeoutMs: number;
  steps: StepResult[];
  metrics: {
    ackRttMs?: number;
    ackRequiredMatrixPassCount?: number;
    ackRequiredMatrixTotal?: number;
    ackRequiredMatrixAckClearMeanMs?: number;
    ackRequiredMatrixAckClearP95Ms?: number;
    replayFirstPageCount?: number;
    replaySecondPageCount?: number;
    replayUniqueIds?: number;
    recoveryPendingAppearMs?: number;
    recoveryAckClearMs?: number;
  };
  error?: string;
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

const serverUrl = arg("--server", "http://127.0.0.1:3300");
const timeoutMs = argInt("--timeout", 8000);
const outPath = arg("--out", "docs/protocol-e2e-baseline.json");
const autoRelay = !hasFlag("--no-auto-relay");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../../..");

function nowMs(): number {
  return performance.now();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(label: string, ms: number, task: Promise<T>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[timeout] ${label} 超时 (${ms}ms)`));
    }, ms);

    task.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((err: unknown) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await withTimeout(
    `HTTP ${label}`,
    timeoutMs,
    fetch(url, init),
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[${label}] HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text) as T;
}

async function fetchHealth(url: string): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${url}/health`);
    if (!res.ok) return null;
    return await res.json() as HealthResponse;
  } catch {
    return null;
  }
}

function resolveServerPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

async function waitRelayHealthy(url: string, waitMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const health = await fetchHealth(url);
    if (health?.ok || health?.status === "ok") return;
    await sleep(250);
  }
  throw new Error(`[relay] 健康检查超时: ${url}/health`);
}

async function connectSocket(name: string, url: string, token: string): Promise<WebSocket> {
  const socket = connectRelayWs(url, token);
  await withTimeout(
    `socket connect: ${name}`,
    timeoutMs,
    waitForWsOpen(socket, timeoutMs),
  );
  return socket;
}

async function waitSocketConnected(name: string, socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await withTimeout(
    `socket reconnect: ${name}`,
    timeoutMs,
    waitForWsOpen(socket, timeoutMs),
  );
}

async function waitForAck(socket: WebSocket, messageId: string): Promise<AckMessage> {
  return await withTimeout(
    `wait ack: ${messageId}`,
    timeoutMs,
    new Promise<AckMessage>((resolve) => {
      const onMessage = (data: any) => {
        const parsed = parseWsFrame(decodeWsData(data));
        if (!parsed.ok) return;
        const frame = parsed.frame as { type: string; data?: any };
        if (frame.type !== "ack") return;
        const ack = frame.data as AckMessage;
        if (ack.messageId !== messageId) return;
        socket.off("message", onMessage);
        resolve(ack);
      };
      socket.on("message", onMessage);
    }),
  );
}

function onWsEnvelope(socket: WebSocket, handler: (env: Envelope) => void): () => void {
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

async function waitForCondition<T>(
  label: string,
  waitMs: number,
  intervalMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const value = await probe();
    if (value !== null) return value;
    await sleep(intervalMs);
  }
  throw new Error(`[${label}] 条件等待超时 (${waitMs}ms)`);
}

function toEnvelopeFromRow(row: QueuePendingResponseRow): Envelope {
  return {
    id: row.id,
    seq: row.seq,
    source: row.source,
    target: row.target,
    sessionId: row.session_id,
    type: row.type,
    ts: row.ts,
    payload: row.payload,
  };
}

function percentileFloor(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * ratio);
  return sorted[idx]!;
}

async function main() {
  const result: ProtocolE2EBaselineResult = {
    status: "pass",
    generatedAt: new Date().toISOString(),
    serverUrl,
    autoRelay,
    timeoutMs,
    steps: [],
    metrics: {},
  };

  const runStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = nowMs();
    try {
      const value = await fn();
      result.steps.push({
        name,
        status: "pass",
        durationMs: Number((nowMs() - start).toFixed(2)),
      });
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.steps.push({
        name,
        status: "fail",
        durationMs: Number((nowMs() - start).toFixed(2)),
        detail: message,
      });
      throw err;
    }
  };

  let relayProcess: any = null;
  let agentSocket: WebSocket | null = null;
  let appSocket: WebSocket | null = null;

  try {
    await runStep("relay-health-or-start", async () => {
      const health = await fetchHealth(serverUrl);
      if (health?.ok || health?.status === "ok") return;
      if (!autoRelay) {
        throw new Error(`[relay] 不可用且已禁用自动拉起: ${serverUrl}`);
      }
      const port = resolveServerPort(serverUrl);
      relayProcess = Bun.spawn(
        ["cargo", "run", "--manifest-path", "crates/relay-server/Cargo.toml"],
        {
          cwd: projectRoot,
          stdout: "inherit",
          stderr: "inherit",
          env: { ...process.env, PORT: String(port) },
        },
      );
      await waitRelayHealthy(serverUrl, 15_000);
    });

    const agentKp = generateKeyPair();
    const appKp = generateKeyPair();

    const pairCreate = await runStep("pair-create", async () => {
      return await fetchJson<PairCreateResponse>(
        `${serverUrl}/api/v1/pair/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: agentKp.publicKey,
            protocolVersion: PROTOCOL_VERSION,
          }),
        },
        "pair/create",
      );
    });

    const pairJoin = await runStep("pair-join", async () => {
      return await fetchJson<PairJoinResponse>(
        `${serverUrl}/api/v1/pair/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: pairCreate.pairingCode,
            publicKey: appKp.publicKey,
            protocolVersion: PROTOCOL_VERSION,
          }),
        },
        "pair/join",
      );
    });

    if (pairCreate.sessionId !== pairJoin.sessionId) {
      throw new Error(
        `[pair] sessionId 不一致: create=${pairCreate.sessionId} join=${pairJoin.sessionId}`,
      );
    }

    const sessionId = pairCreate.sessionId;
    const agentDeviceId = pairCreate.deviceId;
    const appDeviceId = pairJoin.deviceId;
    const appSharedKey = deriveSharedKey(appKp.secretKey, pairJoin.agentPublicKey);
    const agentSharedKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);
    const appSeq = new SeqCounter();
    const agentSeq = new SeqCounter();

    agentSocket = await runStep("socket-connect-agent", async () => {
      return await connectSocket("agent", serverUrl, pairCreate.sessionToken);
    });
    appSocket = await runStep("socket-connect-app", async () => {
      return await connectSocket("app", serverUrl, pairJoin.sessionToken);
    });

    await runStep("ack-round-trip", async () => {
      if (!agentSocket || !appSocket) throw new Error("[ack] socket 未就绪");
      const probe = createEnvelope(
        appDeviceId,
        "broadcast",
        sessionId,
        MessageType.PROMPT,
        "baseline-ack-probe",
        appSharedKey,
        appSeq.next(),
      );
      const onAgentMessage = (envelope: Envelope) => {
        if (envelope.id !== probe.id) return;
        const ack: AckMessage = {
          messageId: envelope.id,
          source: agentDeviceId,
          sessionId,
          state: "ok",
          at: Date.now(),
        };
        agentSocket && sendWsFrame(agentSocket, toWsAckFrame(ack));
      };
      const removeListener = onWsEnvelope(agentSocket, onAgentMessage);
      const startedAt = nowMs();
      sendWsFrame(appSocket, toWsMessageFrame(probe));
      const ack = await waitForAck(appSocket, probe.id);
      removeListener();
      if (ack.source !== agentDeviceId) {
        throw new Error(`[ack] source 异常: expected=${agentDeviceId} actual=${ack.source}`);
      }
      result.metrics.ackRttMs = Number((nowMs() - startedAt).toFixed(2));
    });

    await runStep("ack-required-matrix-pending-clear", async () => {
      if (!agentSocket || !appSocket) throw new Error("[ack-matrix] socket 未就绪");
      const fetchPending = async (): Promise<QueuePendingResponse> => {
        return await fetchJson<QueuePendingResponse>(
          `${serverUrl}/api/v1/queue/pending?limit=200`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${pairCreate.sessionToken}` },
          },
          "queue/pending",
        );
      };
      const cases: Array<{ type: MessageType; payload: string }> = [
        {
          type: MessageType.APPROVAL_RESP,
          payload: JSON.stringify({ id: `approval-${Date.now()}`, approved: true }),
        },
        {
          type: MessageType.SESSION_SWITCH_ACK,
          payload: JSON.stringify({ sessionId, deviceId: appDeviceId, role: "app" }),
        },
        {
          type: MessageType.DIFF_ACTION_RESULT,
          payload: JSON.stringify({ path: "README.md", action: "accept", success: true }),
        },
      ];

      const ackClearDurations: number[] = [];
      for (const tc of cases) {
        agentSocket.close();
        const envelope = createEnvelope(
          appDeviceId,
          agentDeviceId,
          sessionId,
          tc.type,
          tc.payload,
          appSharedKey,
          appSeq.next(),
        );
        sendWsFrame(appSocket, toWsMessageFrame(envelope));

        await waitForCondition(
          `ack-matrix pending appears (${tc.type})`,
          timeoutMs,
          120,
          async () => {
            const res = await fetchPending();
            return res.messages.find((row) => row.id === envelope.id) ?? null;
          },
        );

        agentSocket = await connectSocket("agent", serverUrl, pairCreate.sessionToken);

        const ackStartedAt = nowMs();
        const ack: AckMessage = {
          messageId: envelope.id,
          source: agentDeviceId,
          sessionId,
          state: "ok",
          at: Date.now(),
        };
        sendWsFrame(agentSocket, toWsAckFrame(ack));

        await waitForCondition(
          `ack-matrix pending cleared (${tc.type})`,
          timeoutMs,
          120,
          async () => {
            const res = await fetchPending();
            const exists = res.messages.some((row) => row.id === envelope.id);
            return exists ? null : true;
          },
        );
        ackClearDurations.push(Number((nowMs() - ackStartedAt).toFixed(2)));
      }

      const mean = ackClearDurations.reduce((sum, value) => sum + value, 0) / ackClearDurations.length;
      result.metrics.ackRequiredMatrixPassCount = cases.length;
      result.metrics.ackRequiredMatrixTotal = cases.length;
      result.metrics.ackRequiredMatrixAckClearMeanMs = Number(mean.toFixed(2));
      result.metrics.ackRequiredMatrixAckClearP95Ms = Number(
        percentileFloor(ackClearDurations, 0.95).toFixed(2),
      );
    });

    await runStep("replay-after-cursor", async () => {
      if (!appSocket || !agentSocket) throw new Error("[replay] socket 未就绪");
      const replayWindowStart = Date.now();
      const replayA = createEnvelope(
        appDeviceId,
        agentDeviceId,
        sessionId,
        MessageType.PROMPT,
        `baseline-replay-A-${replayWindowStart}`,
        appSharedKey,
        appSeq.next(),
      );
      const replayB = createEnvelope(
        appDeviceId,
        agentDeviceId,
        sessionId,
        MessageType.PROMPT,
        `baseline-replay-B-${replayWindowStart + 1}`,
        appSharedKey,
        appSeq.next(),
      );

      const replayIds = new Set<string>([replayA.id, replayB.id]);
      const onAgentMessage = (envelope: Envelope) => {
        if (!replayIds.has(envelope.id)) return;
        const ack: AckMessage = {
          messageId: envelope.id,
          source: agentDeviceId,
          sessionId,
          state: "ok",
          at: Date.now(),
        };
        agentSocket && sendWsFrame(agentSocket, toWsAckFrame(ack));
      };
      const removeListener = onWsEnvelope(agentSocket, onAgentMessage);

      sendWsFrame(appSocket, toWsMessageFrame(replayA));
      await waitForAck(appSocket, replayA.id);
      sendWsFrame(appSocket, toWsMessageFrame(replayB));
      await waitForAck(appSocket, replayB.id);
      removeListener();
      agentSocket.off("message", onAgentMessage);

      const fetchMessages = async (params: URLSearchParams): Promise<MessagesResponse> => {
        return await fetchJson<MessagesResponse>(
          `${serverUrl}/api/v1/sessions/${sessionId}/messages?${params.toString()}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${pairJoin.sessionToken}` },
          },
          `sessions/${sessionId}/messages`,
        );
      };

      await waitForCondition(
        "replay persisted",
        timeoutMs,
        120,
        async () => {
          const params = new URLSearchParams({
            after: String(replayWindowStart - 1),
            limit: "20",
          });
          const res = await fetchMessages(params);
          const ids = new Set(res.messages.map((row) => row.id));
          if (ids.has(replayA.id) && ids.has(replayB.id)) return true;
          return null;
        },
      );

      const firstPage = await fetchMessages(new URLSearchParams({
        after: String(replayWindowStart - 1),
        limit: "1",
      }));
      if (!firstPage.messages[0]) {
        throw new Error("[replay] 第一页为空");
      }
      const secondPage = await fetchMessages(new URLSearchParams({
        afterCursor: String(firstPage.nextCursor),
        limit: "20",
      }));

      const seenIds = new Set<string>();
      for (const row of firstPage.messages) seenIds.add(row.id);
      for (const row of secondPage.messages) seenIds.add(row.id);
      if (!seenIds.has(replayA.id) || !seenIds.has(replayB.id)) {
        throw new Error(
          `[replay] afterCursor 分页结果缺失目标消息: a=${replayA.id} b=${replayB.id}`,
        );
      }

      result.metrics.replayFirstPageCount = firstPage.count;
      result.metrics.replaySecondPageCount = secondPage.count;
      result.metrics.replayUniqueIds = seenIds.size;
    });

    await runStep("recovery-pending-ack-clear", async () => {
      if (!agentSocket || !appSocket) throw new Error("[recovery] socket 未就绪");
      appSocket.close();
      const recoveryPrompt = `baseline-recovery-${Date.now()}`;
      const envelope = createEnvelope(
        agentDeviceId,
        appDeviceId,
        sessionId,
        MessageType.PROMPT,
        recoveryPrompt,
        agentSharedKey,
        agentSeq.next(),
      );

      const sentAt = nowMs();
      sendWsFrame(agentSocket, toWsMessageFrame(envelope));

      const fetchPending = async (): Promise<QueuePendingResponse> => {
        return await fetchJson<QueuePendingResponse>(
          `${serverUrl}/api/v1/queue/pending?limit=100`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${pairJoin.sessionToken}` },
          },
          "queue/pending",
        );
      };

      const pendingRow = await waitForCondition(
        "pending appears",
        timeoutMs,
        120,
        async () => {
          const res = await fetchPending();
          return res.messages.find((row) => row.id === envelope.id) ?? null;
        },
      );
      result.metrics.recoveryPendingAppearMs = Number((nowMs() - sentAt).toFixed(2));

      const restoredText = openEnvelope(toEnvelopeFromRow(pendingRow), appSharedKey);
      if (restoredText !== recoveryPrompt) {
        throw new Error(
          `[recovery] 离线队列解密不一致: expected=${recoveryPrompt} actual=${restoredText}`,
        );
      }

      appSocket = await connectSocket("app", serverUrl, pairJoin.sessionToken);

      const ackStartedAt = nowMs();
      const ack: AckMessage = {
        messageId: envelope.id,
        source: appDeviceId,
        sessionId,
        state: "ok",
        at: Date.now(),
      };
      sendWsFrame(appSocket, toWsAckFrame(ack));

      await waitForCondition(
        "pending cleared",
        timeoutMs,
        120,
        async () => {
          const res = await fetchPending();
          const exists = res.messages.some((row) => row.id === envelope.id);
          return exists ? null : true;
        },
      );
      result.metrics.recoveryAckClearMs = Number((nowMs() - ackStartedAt).toFixed(2));
    });

    console.log("[protocol-e2e] 全部步骤通过");
  } catch (err) {
    result.status = "fail";
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[protocol-e2e] 失败: ${result.error}`);
  } finally {
    try {
      appSocket?.close();
      agentSocket?.close();
    } catch {
      // ignore cleanup errors
    }

    const relay: any = relayProcess;
    if (relay) {
      relay.kill?.();
      if (relay.exited) await relay.exited;
    }

    const fullOutPath = resolve(projectRoot, outPath);
    await mkdir(dirname(fullOutPath), { recursive: true });
    await writeFile(fullOutPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`[protocol-e2e] 结果已写入: ${outPath}`);
    if (result.metrics.ackRttMs !== undefined) {
      console.log(
        `[protocol-e2e] ackRtt=${result.metrics.ackRttMs}ms, pendingAppear=${result.metrics.recoveryPendingAppearMs ?? -1}ms, pendingClear=${result.metrics.recoveryAckClearMs ?? -1}ms`,
      );
    }
  }

  if (result.status === "fail") process.exit(1);
}

await main();

import {
  generateKeyPair,
  deriveSharedKey,
  createEnvelope,
  openEnvelope,
  MessageType,
  SeqCounter,
} from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";
import {
  connectRelayWs,
  decodeWsData,
  isTextEnvelope,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsMessageFrame,
} from "./relay-options";

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const serverUrl = getArg("--server", "http://localhost:3000");
const prompt = getArg("--prompt", "请做流式输出可视化测试");
const delayMs = Number(getArg("--delay-ms", "120"));

async function createPairWithRetry() {
  const kp = generateKeyPair();
  let res = await fetch(`${serverUrl}/api/v1/pair/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp.publicKey }),
  });

  if (res.status === 429) {
    console.log("[stream-visible] rate limited, wait 70s and retry...");
    await sleep(70000);
    res = await fetch(`${serverUrl}/api/v1/pair/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: kp.publicKey }),
    });
  }

  if (!res.ok) {
    throw new Error(`pair/create failed: ${res.status}`);
  }

  const data = await res.json();
  return { kp, data };
}

async function waitForAppKey(pairingCode: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const res = await fetch(`${serverUrl}/api/v1/pair/status/${pairingCode}`);
    const data = await res.json();
    if (data.joined && data.appPublicKey) return data.appPublicKey as string;
    await sleep(300);
  }
  throw new Error("app join timeout");
}

const { kp: agentKp, data: pair } = await createPairWithRetry();
const { pairingCode, sessionToken, deviceId, sessionId } = pair as Record<string, string>;
console.log(`[stream-visible] pairingCode=${pairingCode}`);

let sharedKey: Uint8Array | null = null;
let pendingPrompt: Envelope | null = null;
const seq = new SeqCounter();

const socket = connectRelayWs(serverUrl, sessionToken);

socket.on("open", () => {
  console.log("[stream-visible] mock agent connected");
});

socket.on("message", (data) => {
  const parsed = parseWsFrame(decodeWsData(data));
  if (!parsed.ok) return;
  const frame = parsed.frame as { type: string; data?: unknown };
  if (frame.type !== "message") return;
  const env = normalizeEnvelopePayload(frame.data as Envelope);
  if (!isTextEnvelope(env)) return;
  if (env.type !== MessageType.PROMPT) return;
  if (!sharedKey) {
    pendingPrompt = env;
    return;
  }
  void handlePrompt(env);
});

async function handlePrompt(env: Envelope) {
  if (!sharedKey) return;

  const userPrompt = openEnvelope(env, sharedKey);
  const frames = [
    `[stream-visible] user prompt: ${userPrompt}\n`,
    "Streaming demo: ",
    "A",
    "B",
    "C\n",
    "```kotlin\n",
    "fun greet(name: String) {\n",
    "    println(\"hi, $name\")\n",
    "}\n",
    "```\n",
    "[stream-visible] done.\n",
  ];

  for (let i = 0; i < frames.length; i++) {
    const chunk = createEnvelope(
      deviceId,
      "broadcast",
      sessionId,
      MessageType.STREAM_CHUNK,
      frames[i]!,
      sharedKey,
      seq.next(),
    );
    sendWsFrame(socket, toWsMessageFrame(chunk));
    await sleep(Math.max(10, delayMs));
  }

  const end = createEnvelope(
    deviceId,
    "broadcast",
    sessionId,
    MessageType.STREAM_END,
    "",
    sharedKey,
    seq.next(),
  );
  sendWsFrame(socket, toWsMessageFrame(end));
}

const appKeyPromise = waitForAppKey(pairingCode).then((appPublicKey) => {
  sharedKey = deriveSharedKey(agentKp.secretKey, appPublicKey);
  console.log("[stream-visible] shared key ready");
  if (pendingPrompt) {
    const p = pendingPrompt;
    pendingPrompt = null;
    void handlePrompt(p);
  }
});

const proc = Bun.spawn([
  "bun",
  "run",
  "packages/cli/src/test-e2e.ts",
  "--pairing-code",
  pairingCode,
  "--server",
  serverUrl,
  "--prompt",
  prompt,
], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });

const [out, err, code] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
  appKeyPromise,
]);

if (out) process.stdout.write(out);
if (err) process.stderr.write(err);

socket.close();
process.exit(code ?? 1);

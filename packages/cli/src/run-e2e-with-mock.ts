import {
  DEFAULT_E2EE_INFO,
  MessageType,
  PROTOCOL_VERSION,
  SeqCounter,
  createEnvelopeWeb,
  deriveAesGcmKey,
  generateWebKeyPair,
  openEnvelopeWeb,
  type Envelope,
} from "@yuanio/shared";
import {
  connectRelayWs,
  decodeWsData,
  isTextEnvelope,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsMessageFrame,
} from "./relay-options";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PairCreateResponse {
  pairingCode: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
}

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const serverUrl = getArg("--server", "http://localhost:3000");
const prompt = getArg("--prompt", "say hello");
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function createPairWithRetry() {
  const keyPair = await generateWebKeyPair();
  let res = await fetch(`${serverUrl}/api/v1/pair/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-yuanio-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({ publicKey: keyPair.publicKey, protocolVersion: PROTOCOL_VERSION }),
  });

  if (res.status === 429) {
    console.log("[wrapper] rate limited, wait 70s and retry...");
    await sleep(70000);
    res = await fetch(`${serverUrl}/api/v1/pair/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-yuanio-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({ publicKey: keyPair.publicKey, protocolVersion: PROTOCOL_VERSION }),
    });
  }

  if (!res.ok) {
    throw new Error(`pair/create failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as PairCreateResponse;
  return { keyPair, data };
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

const { keyPair: agentKeyPair, data: pair } = await createPairWithRetry();
const { pairingCode, sessionToken, deviceId, sessionId } = pair;
console.log(`[wrapper] pairingCode=${pairingCode}`);

let sharedKey: CryptoKey | null = null;
let pendingPrompt: Envelope | null = null;
const seq = new SeqCounter();

const socket = connectRelayWs(serverUrl, sessionToken);

socket.on("open", () => {
  console.log("[wrapper] mock agent connected");
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
  const userPrompt = await openEnvelopeWeb(env, sharedKey);
  const reply = `OK: ${userPrompt}`;
  const chunk = await createEnvelopeWeb(
    deviceId,
    "broadcast",
    sessionId,
    MessageType.STREAM_CHUNK,
    reply,
    sharedKey,
    seq.next(),
  );
  const end = await createEnvelopeWeb(
    deviceId,
    "broadcast",
    sessionId,
    MessageType.STREAM_END,
    "",
    sharedKey,
    seq.next(),
  );
  sendWsFrame(socket, toWsMessageFrame(chunk));
  sendWsFrame(socket, toWsMessageFrame(end));
}

const appKeyPromise = waitForAppKey(pairingCode).then(async (appPublicKey) => {
  sharedKey = await deriveAesGcmKey({
    privateKey: agentKeyPair.privateKey,
    publicKey: appPublicKey,
    salt: sessionId,
    info: DEFAULT_E2EE_INFO,
  });
  console.log("[wrapper] shared key ready");
  if (pendingPrompt) {
    const promptEnvelope = pendingPrompt;
    pendingPrompt = null;
    await handlePrompt(promptEnvelope);
  }
});

const proc = Bun.spawn([
  "bun",
  "run",
  "src/test-e2e.ts",
  "--pairing-code",
  pairingCode,
  "--server",
  serverUrl,
  "--prompt",
  prompt,
], { cwd: cliRoot, stdout: "pipe", stderr: "pipe" });

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

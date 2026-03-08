import { io } from "socket.io-client";
import {
  generateKeyPair,
  deriveSharedKey,
  createEnvelope,
  openEnvelope,
  MessageType,
  SeqCounter,
} from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";
import { createRelaySocketOptions } from "./relay-options";

const serverUrl = "http://localhost:3000";
const prompt = "hello";

async function createPairWithRetry() {
  const kp = generateKeyPair();
  let res = await fetch(`${serverUrl}/api/v1/pair/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp.publicKey }),
  });

  if (res.status === 429) {
    console.log("[wrapper] rate limited, wait 70s and retry...");
    await new Promise((r) => setTimeout(r, 70000));
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
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("app join timeout");
}

const { kp: agentKp, data: pair } = await createPairWithRetry();
const { pairingCode, sessionToken, deviceId, sessionId } = pair as any;
console.log(`[wrapper] pairingCode=${pairingCode}`);

let sharedKey: Uint8Array | null = null;
let pendingPrompt: Envelope | null = null;
const seq = new SeqCounter();

const socket = io(`${serverUrl}/relay`, createRelaySocketOptions(sessionToken));

socket.on("connect", () => {
  console.log("[wrapper] mock agent connected");
});

socket.on("message", (env: Envelope) => {
  if (env.type !== MessageType.PROMPT) return;
  if (!sharedKey) {
    pendingPrompt = env;
    return;
  }
  handlePrompt(env);
});

function handlePrompt(env: Envelope) {
  if (!sharedKey) return;
  const userPrompt = openEnvelope(env, sharedKey);
  const reply = `OK: ${userPrompt}`;
  const chunk = createEnvelope(
    deviceId,
    "broadcast",
    sessionId,
    MessageType.STREAM_CHUNK,
    reply,
    sharedKey,
    seq.next(),
  );
  const end = createEnvelope(
    deviceId,
    "broadcast",
    sessionId,
    MessageType.STREAM_END,
    "",
    sharedKey,
    seq.next(),
  );
  socket.emit("message", chunk);
  socket.emit("message", end);
}

const appKeyPromise = waitForAppKey(pairingCode).then((appPublicKey) => {
  sharedKey = deriveSharedKey(agentKp.secretKey, appPublicKey);
  console.log("[wrapper] shared key ready");
  if (pendingPrompt) {
    const p = pendingPrompt;
    pendingPrompt = null;
    handlePrompt(p);
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

socket.disconnect();
process.exit(code ?? 1);

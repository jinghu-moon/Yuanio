import assert from "node:assert/strict";
import {
  buildRelayWsUrl,
  createRelayHelloFrame,
  encodeWsFrame,
  normalizeEnvelopePayload,
  parseWsFrame,
  toWsMessageFrame,
} from "./relay-options";
import { MessageType, PROTOCOL_VERSION } from "@yuanio/shared";

const wsUrl = buildRelayWsUrl("http://localhost:3000/api/v1");
assert.equal(wsUrl, "ws://localhost:3000/relay-ws");
const wssFromHttps = buildRelayWsUrl("https://localhost:3000/api/v1");
assert.equal(wssFromHttps, "wss://localhost:3000/relay-ws");
const wssFromWss = buildRelayWsUrl("wss://relay.example.com/api/v1");
assert.equal(wssFromWss, "wss://relay.example.com/relay-ws");

const hello = createRelayHelloFrame("token");
assert.deepEqual(hello, { type: "hello", data: { token: "token", protocolVersion: PROTOCOL_VERSION } });

const binaryEnv = {
  id: "env-1",
  seq: 1,
  source: "app",
  target: "agent",
  sessionId: "s1",
  type: MessageType.PTY_OUTPUT,
  ts: Date.now(),
  payload: new Uint8Array([1, 2, 3]),
};
const frame = toWsMessageFrame(binaryEnv);
const encoded = encodeWsFrame(frame);
const parsed = parseWsFrame(encoded);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error("ws frame parse failed");
const normalized = normalizeEnvelopePayload((parsed.frame as { data: any }).data);
assert.ok(normalized.payload instanceof Uint8Array);

console.log("test-relay-options passed");

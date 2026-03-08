import assert from "node:assert/strict";
import {
  RELAY_PING_INTERVAL_MS,
  RELAY_PING_TIMEOUT_MS,
} from "./socket-options";

assert.equal(RELAY_PING_INTERVAL_MS, 20_000);
assert.equal(RELAY_PING_TIMEOUT_MS, 20_000);
assert.ok(
  RELAY_PING_INTERVAL_MS + RELAY_PING_TIMEOUT_MS < 60_000,
  "pingInterval + pingTimeout 应小于常见 60s 代理超时",
);

console.log("test-socket-options passed");

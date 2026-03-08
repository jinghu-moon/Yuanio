import assert from "node:assert/strict";
import {
  createRelaySocketOptions,
  ensurePollingFallback,
  POLLING_FIRST_TRANSPORTS,
  WEBSOCKET_FIRST_TRANSPORTS,
} from "./relay-options";
import { PROTOCOL_VERSION } from "@yuanio/shared";

const options = createRelaySocketOptions("token");
assert.deepEqual(options.transports, [...WEBSOCKET_FIRST_TRANSPORTS]);
assert.equal(options.reconnection, true);
assert.equal(options.reconnectionDelay, 300);
assert.equal(options.reconnectionDelayMax, 5000);
assert.equal(options.randomizationFactor, 0.2);
assert.equal(options.timeout, 5000);
assert.equal(options.rememberUpgrade, false);
assert.equal(options.upgrade, false);
assert.equal(options.tryAllTransports, false);
assert.deepEqual(options.auth, { token: "token", protocolVersion: PROTOCOL_VERSION });

const fallbackOpts = { transports: [...WEBSOCKET_FIRST_TRANSPORTS], rememberUpgrade: true };
assert.equal(ensurePollingFallback(fallbackOpts), false);
assert.deepEqual(fallbackOpts.transports, [...WEBSOCKET_FIRST_TRANSPORTS]);
assert.equal(fallbackOpts.rememberUpgrade, true);

const noChangeOpts = { transports: [...POLLING_FIRST_TRANSPORTS] };
assert.equal(ensurePollingFallback(noChangeOpts), false);
assert.deepEqual(noChangeOpts.transports, [...POLLING_FIRST_TRANSPORTS]);

const missingOpts = {} as { transports?: string[] };
assert.equal(ensurePollingFallback(missingOpts), false);

console.log("test-relay-options passed");

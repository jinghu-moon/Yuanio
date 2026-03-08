import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const tmpDir = join(process.cwd(), ".tmp");
mkdirSync(tmpDir, { recursive: true });
process.env.YUANIO_DB_PATH = join(tmpDir, `test-relay-queue-${Date.now()}.db`);

const db = await import("./db");
const { resolveDeliveryTargets } = await import("./delivery-queue");

const sessionId = "session-1";
const agentId = "agent-1";
const appId = "app-1";

db.createSession(sessionId);
db.addDevice(agentId, "agent-pk", "agent", sessionId, "agent-token");
db.addDevice(appId, "app-pk", "app", sessionId, "app-token");

// resolveDeliveryTargets 覆盖：broadcast / 指定 / 自发
const devices = db.getDevicesBySession(sessionId);
assert.deepEqual(resolveDeliveryTargets("broadcast", agentId, devices), [appId]);
assert.deepEqual(resolveDeliveryTargets(appId, agentId, devices), [appId]);
assert.deepEqual(resolveDeliveryTargets(agentId, agentId, devices), []);

const messageId = "msg-1";
const now = Date.now();
db.saveEncryptedMessage({
  id: messageId,
  session_id: sessionId,
  source: agentId,
  target: "broadcast",
  type: "prompt",
  seq: 1,
  ts: now,
  payload: "payload",
});

// 重复入队应去重
db.queueDelivery(messageId, sessionId, agentId, appId);
db.queueDelivery(messageId, sessionId, agentId, appId);
let pending = db.getPendingDeliveries(appId, 10);
assert.equal(pending.length, 1);
assert.equal(pending[0].id, messageId);

// ACK 未命中不应报错
assert.equal(db.markDeliveryAcked("missing", appId), false);

// ACK 命中后应清空队列
assert.equal(db.markDeliveryAcked(messageId, appId), true);
pending = db.getPendingDeliveries(appId, 10);
assert.equal(pending.length, 0);

console.log("test-queue passed");

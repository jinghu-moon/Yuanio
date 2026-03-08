import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Envelope } from "@yuanio/shared";

const tmpDir = join(process.cwd(), ".tmp");
mkdirSync(tmpDir, { recursive: true });
process.env.YUANIO_DAEMON_STATE = join(tmpDir, `daemon-state-${Date.now()}.json`);

const daemon = await import("./daemon");
const { fetchDaemonCachedMessages, clearDaemonCache } = await import("./daemon-client");

const originalFetch = globalThis.fetch;
const withPreconnect = (fn: (url: any, options?: any) => Promise<Response>): typeof fetch =>
  Object.assign(fn, { preconnect: () => {} });

try {
  // 无状态文件：应返回 null
  assert.equal(daemon.readState(), null);
  const none = await fetchDaemonCachedMessages();
  assert.equal(none, null);

  // 写入状态并模拟 daemon 接口
  daemon.writeState({
    pid: 123,
    port: 4567,
    version: "0.1.0",
    startedAt: new Date().toISOString(),
    sessions: [],
  });

  const sample: Envelope = {
    id: "m1",
    seq: 1,
    source: "app",
    target: "broadcast",
    sessionId: "s1",
    type: "prompt" as any,
    ts: Date.now(),
    payload: "payload",
  };

  globalThis.fetch = withPreconnect(async (url: any, options?: any) => {
    const u = String(url);
    if (u.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (u.endsWith("/messages")) {
      return new Response(JSON.stringify({ messages: [{ envelope: sample }] }), { status: 200 });
    }
    if (u.endsWith("/messages/clear")) {
      return new Response(JSON.stringify({ cleared: 1 }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  const cached = await fetchDaemonCachedMessages();
  assert.ok(cached);
  assert.equal(cached!.messages.length, 1);
  assert.equal(cached!.messages[0].id, "m1");

  await clearDaemonCache(cached!.baseUrl);

  console.log("test-daemon-client passed");
} finally {
  globalThis.fetch = originalFetch;
}

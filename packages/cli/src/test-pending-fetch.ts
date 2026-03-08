import assert from "node:assert/strict";
import type { Envelope } from "@yuanio/shared";
import { fetchPendingEnvelopes } from "./pending";

const originalFetch = globalThis.fetch;
const withPreconnect = (fn: (url: any, options?: any) => Promise<Response>): typeof fetch =>
  Object.assign(fn, { preconnect: () => {} });

try {
  // 成功路径
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
  let seenUrl = "";
  let seenAuth = "";
  globalThis.fetch = withPreconnect(async (url: any, options?: any) => {
    seenUrl = String(url);
    seenAuth = options?.headers?.Authorization || "";
    return new Response(JSON.stringify({ messages: [sample] }), { status: 200 });
  });
  const messages = await fetchPendingEnvelopes("http://localhost:3000", "token-1", 5);
  assert.equal(messages.length, 1);
  assert.ok(seenUrl.includes("/api/v1/queue/pending?limit=5"));
  assert.equal(seenAuth, "Bearer token-1");

  // 错误路径：非 2xx
  globalThis.fetch = withPreconnect(async () => new Response("fail", { status: 500 }));
  await assert.rejects(
    () => fetchPendingEnvelopes("http://localhost:3000", "token-1", 1),
    /pending fetch failed/,
  );

  // 边界：无 messages 字段
  globalThis.fetch = withPreconnect(async () => new Response(JSON.stringify({}), { status: 200 }));
  const empty = await fetchPendingEnvelopes("http://localhost:3000", "token-1", 1);
  assert.equal(empty.length, 0);

  console.log("test-pending-fetch passed");
} finally {
  globalThis.fetch = originalFetch;
}

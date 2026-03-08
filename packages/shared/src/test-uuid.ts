import { generateUUIDv7 } from "./crypto";
import { createEnvelope, SeqCounter } from "./envelope";
import { MessageType } from "./types";
import { deriveSharedKey, generateKeyPair } from "./crypto";

// 1. UUID v7 格式验证
const id = generateUUIDv7();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
console.log("UUID v7:", id);
console.assert(uuidRegex.test(id), " UUID v7 格式不正确");
console.log(" 格式正确（version=7, variant=10xx）");

// 2. 时间有序性
const ids = Array.from({ length: 5 }, () => {
  const u = generateUUIDv7();
  return u;
});
const sorted = [...ids].sort();
console.assert(JSON.stringify(ids) === JSON.stringify(sorted), " UUID 不是时间有序的");
console.log(" 时间有序（5 个连续 UUID 自然排序一致）");

// 3. 唯一性
const set = new Set(Array.from({ length: 1000 }, () => generateUUIDv7()));
console.assert(set.size === 1000, " UUID 存在重复");
console.log(" 唯一性（1000 个无重复）");

// 4. SeqCounter 递增验证
const seq = new SeqCounter();
console.assert(seq.next() === 1, " seq 应从 1 开始");
console.assert(seq.next() === 2, " seq 应递增");
console.assert(seq.current() === 2, " current 应返回当前值");
console.log(" SeqCounter 递增正确");

// 5. createEnvelope 扁平结构验证
const kp1 = generateKeyPair();
const kp2 = generateKeyPair();
const key = deriveSharedKey(kp1.secretKey, kp2.publicKey);
const env = createEnvelope("dev1", "dev2", "sess1", MessageType.PROMPT, "hello", key, seq.next());
console.assert(uuidRegex.test(env.id), " 信封 id 格式不正确");
console.assert(env.seq === 3, " 信封 seq 不正确");
console.assert(env.source === "dev1", " source 不正确");
console.assert(env.target === "dev2", " target 不正确");
console.assert(env.type === "prompt", " type 不正确");
console.assert(typeof env.ts === "number", " ts 不是数字");
console.assert((env as any).header === undefined, " 不应存在 header 字段");
console.log(" 扁平信封结构正确: id=" + env.id, "seq=" + env.seq, "source=" + env.source);

console.log("\n 所有测试通过");

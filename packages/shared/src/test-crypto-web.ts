import { generateWebKeyPair, deriveAesGcmKey, encryptAead, decryptAead, DEFAULT_E2EE_INFO } from "./crypto-web";

const salt = "session:sess1";
const info = DEFAULT_E2EE_INFO;
const aad = JSON.stringify({ sessionId: "sess1", seq: 1, type: "prompt" });

const agent = await generateWebKeyPair();
const app = await generateWebKeyPair();

const agentKey = await deriveAesGcmKey({
  privateKey: agent.privateKey,
  publicKey: app.publicKey,
  salt,
  info,
});

const appKey = await deriveAesGcmKey({
  privateKey: app.privateKey,
  publicKey: agent.publicKey,
  salt,
  info,
});

const ciphertext = await encryptAead("hello", agentKey, aad);
const plaintext = await decryptAead(ciphertext, appKey, aad);
console.assert(plaintext === "hello", " AES-GCM 解密失败");

let aadFailed = false;
try {
  await decryptAead(ciphertext, appKey, aad + "x");
} catch {
  aadFailed = true;
}
console.assert(aadFailed, " AAD 变化应导致解密失败");

let keyFailed = false;
try {
  const wrongKey = await deriveAesGcmKey({
    privateKey: agent.privateKey,
    publicKey: app.publicKey,
    salt: "session:other",
    info,
  });
  await decryptAead(ciphertext, wrongKey, aad);
} catch {
  keyFailed = true;
}
console.assert(keyFailed, " 错误密钥应导致解密失败");

console.log("\n WebCrypto E2EE 基本测试通过");

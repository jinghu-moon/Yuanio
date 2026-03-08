import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

export interface KeyPair {
  publicKey: string;  // Base64
  secretKey: string;  // Base64
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

export function deriveSharedKey(mySecretKey: string, theirPublicKey: string): Uint8Array {
  return nacl.box.before(
    decodeBase64(theirPublicKey),
    decodeBase64(mySecretKey),
  );
}

// UUID v7: 时间有序，同毫秒内单调递增
let _lastMs = 0;
let _seqBits = 0;

export function generateUUIDv7(): string {
  const now = Date.now();
  if (now === _lastMs) {
    _seqBits++;
  } else {
    _lastMs = now;
    _seqBits = 0;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48-bit timestamp (ms)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  // version 7 + 12-bit monotonic counter
  bytes[6] = 0x70 | ((_seqBits >> 8) & 0x0f);
  bytes[7] = _seqBits & 0xff;
  // variant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encrypt(plaintext: string, sharedKey: Uint8Array): string {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msgBytes = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.box.after(msgBytes, nonce, sharedKey);
  // nonce(24B) + ciphertext → Base64
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return encodeBase64(combined);
}

export function decrypt(encoded: string, sharedKey: Uint8Array): string {
  const combined = decodeBase64(encoded);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const plaintext = nacl.box.open.after(ciphertext, nonce, sharedKey);
  if (!plaintext) throw new Error("Decryption failed");
  return new TextDecoder().decode(plaintext);
}

// --- Binary 变体：跳过 Base64，减少 33% 带宽 ---

export function encryptRaw(plaintext: string, sharedKey: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msgBytes = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.box.after(msgBytes, nonce, sharedKey);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return combined;
}

export function decryptRaw(data: Uint8Array, sharedKey: Uint8Array): string {
  const nonce = data.slice(0, nacl.box.nonceLength);
  const ciphertext = data.slice(nacl.box.nonceLength);
  const plaintext = nacl.box.open.after(ciphertext, nonce, sharedKey);
  if (!plaintext) throw new Error("Decryption failed");
  return new TextDecoder().decode(plaintext);
}

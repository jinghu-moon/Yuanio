const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const AES_GCM_IV_LENGTH = 12;
export const DEFAULT_E2EE_INFO = "yuanio-e2ee-v1";

export interface WebKeyPair {
  publicKey: string;  // Base64(SPKI)
  privateKey: string; // Base64(PKCS8)
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function ensureBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? textEncoder.encode(value) : value;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const combined = new Uint8Array(a.length + b.length);
  combined.set(a, 0);
  combined.set(b, a.length);
  return combined;
}

function requireNonEmptyBytes(name: string, value: string | Uint8Array): Uint8Array {
  const bytes = ensureBytes(value);
  if (bytes.length === 0) {
    throw new Error(`${name} is required`);
  }
  return bytes;
}

export async function generateWebKeyPair(): Promise<WebKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    publicKey: bytesToBase64(new Uint8Array(publicKey)),
    privateKey: bytesToBase64(new Uint8Array(privateKey)),
  };
}

export async function deriveAesGcmKey(params: {
  privateKey: string;
  publicKey: string;
  salt: string | Uint8Array;
  info?: string | Uint8Array;
}): Promise<CryptoKey> {
  const { privateKey, publicKey, salt, info } = params;
  const privateKeyBytes = base64ToBytes(privateKey);
  const publicKeyBytes = base64ToBytes(publicKey);

  const priv = await crypto.subtle.importKey(
    "pkcs8",
    toBufferSource(privateKeyBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const pub = await crypto.subtle.importKey(
    "spki",
    toBufferSource(publicKeyBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    priv,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const saltBytes = requireNonEmptyBytes("salt", salt);
  const infoBytes = info ? ensureBytes(info) : textEncoder.encode(DEFAULT_E2EE_INFO);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBufferSource(saltBytes), info: toBufferSource(infoBytes) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptAead(
  plaintext: string,
  key: CryptoKey,
  aad?: string | Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const data = textEncoder.encode(plaintext);
  const additionalData = aad ? ensureBytes(aad) : undefined;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData ? toBufferSource(additionalData) : undefined },
    key,
    toBufferSource(data),
  );
  return bytesToBase64(concatBytes(iv, new Uint8Array(encrypted)));
}

export async function decryptAead(
  payloadBase64: string,
  key: CryptoKey,
  aad?: string | Uint8Array,
): Promise<string> {
  const payload = base64ToBytes(payloadBase64);
  const iv = payload.slice(0, AES_GCM_IV_LENGTH);
  const ciphertext = payload.slice(AES_GCM_IV_LENGTH);
  const additionalData = aad ? ensureBytes(aad) : undefined;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: additionalData ? toBufferSource(additionalData) : undefined },
    key,
    toBufferSource(ciphertext),
  );
  return textDecoder.decode(decrypted);
}

export async function encryptAeadRaw(
  plaintext: string,
  key: CryptoKey,
  aad?: string | Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const data = textEncoder.encode(plaintext);
  const additionalData = aad ? ensureBytes(aad) : undefined;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData ? toBufferSource(additionalData) : undefined },
    key,
    toBufferSource(data),
  );
  return concatBytes(iv, new Uint8Array(encrypted));
}

export async function decryptAeadRaw(
  payload: Uint8Array | ArrayBuffer,
  key: CryptoKey,
  aad?: string | Uint8Array,
): Promise<string> {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const iv = data.slice(0, AES_GCM_IV_LENGTH);
  const ciphertext = data.slice(AES_GCM_IV_LENGTH);
  const additionalData = aad ? ensureBytes(aad) : undefined;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: additionalData ? toBufferSource(additionalData) : undefined },
    key,
    toBufferSource(ciphertext),
  );
  return textDecoder.decode(decrypted);
}

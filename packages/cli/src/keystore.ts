import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), ".yuanio");
const FILE = join(DIR, "keys.json");
const SESSION_TOKEN_FILE = (process.env.YUANIO_SESSION_TOKEN_FILE || "").trim();

export interface StoredKeys {
  cryptoVersion?: "nacl" | "webcrypto";
  protocolVersion?: string;
  namespace?: string;
  publicKey: string;
  secretKey: string;
  deviceId: string;
  sessionId: string;
  sessionToken: string;
  peerPublicKey: string;
  serverUrl: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

function readSessionTokenFromTokenFile(): string | null {
  if (!SESSION_TOKEN_FILE || !existsSync(SESSION_TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(SESSION_TOKEN_FILE, "utf-8").trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      if (typeof parsed?.sessionToken === "string" && parsed.sessionToken.trim()) {
        return parsed.sessionToken.trim();
      }
    }
    const firstLine = raw.split(/\r?\n/, 1)[0];
    return firstLine?.trim() || null;
  } catch {
    return null;
  }
}

function writeSessionTokenToTokenFile(sessionToken: string): void {
  if (!SESSION_TOKEN_FILE || !sessionToken) return;
  try {
    mkdirSync(dirname(SESSION_TOKEN_FILE), { recursive: true });
    writeFileSync(SESSION_TOKEN_FILE, `${sessionToken}\n`);
    try { chmodSync(SESSION_TOKEN_FILE, 0o600); } catch {}
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[keystore] 写入 token 文件失败: ${msg}`);
  }
}

export function saveKeys(keys: StoredKeys) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(keys, null, 2));
  try { chmodSync(FILE, 0o600); } catch {}
  writeSessionTokenToTokenFile(keys.sessionToken);
}

export function loadKeys(): StoredKeys | null {
  if (!existsSync(FILE)) return null;
  const keys = JSON.parse(readFileSync(FILE, "utf-8")) as StoredKeys;
  const tokenFromFile = readSessionTokenFromTokenFile();
  if (tokenFromFile && tokenFromFile !== keys.sessionToken) {
    keys.sessionToken = tokenFromFile;
  }
  return keys;
}

export function hasKeys(): boolean {
  return existsSync(FILE);
}

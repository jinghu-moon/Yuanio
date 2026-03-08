import { SignJWT, jwtVerify } from "jose";
import { isTokenRevoked } from "./db";
import { DEFAULT_NAMESPACE, PROTOCOL_VERSION, normalizeNamespace, requireRelayJwtSecret } from "@yuanio/shared";
import { logger } from "./logger";

const MIN_SECRET_LENGTH = 32;

function resolveSecret(): Uint8Array {
  const configured = requireRelayJwtSecret({ env: process.env, startDir: import.meta.dir });

  if (configured.length < MIN_SECRET_LENGTH) {
    throw new Error(`[jwt] JWT_SECRET 杩囩煭锛岃嚦灏戦渶瑕?${MIN_SECRET_LENGTH} 瀛楃`);
  }

  logger.info({ secretLength: configured.length }, "JWT secret loaded");
  return new TextEncoder().encode(configured);
}

// ?????
const SECRET = resolveSecret();
const ISSUER = "yuanio-relay";
const EXPIRY = "24h";

export interface TokenPayload {
  deviceId: string;
  sessionId: string;
  role: string;
  namespace: string;
  protocolVersion: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  const namespace = normalizeNamespace(payload.namespace);
  const protocolVersion = payload.protocolVersion || PROTOCOL_VERSION;
  return new SignJWT({ ...payload, namespace, protocolVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .setSubject(`${namespace}:${payload.deviceId}`)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
    // 妫€鏌ユ槸鍚﹀凡鍚婇攢
if (isTokenRevoked(token)) return null;
    const obj = payload as unknown as Partial<TokenPayload>;
    if (!obj.deviceId || !obj.sessionId || !obj.role) return null;
    return {
      deviceId: obj.deviceId,
      sessionId: obj.sessionId,
      role: obj.role,
      namespace: normalizeNamespace(obj.namespace || DEFAULT_NAMESPACE),
      protocolVersion: obj.protocolVersion || "0.0.0",
    };
  } catch {
    return null;
  }
}

/**
 * 瀹介檺鏈熼獙璇侊細鍏佽杩囨湡鍚?1h 鍐呯殑 token 閫氳繃楠岃瘉锛堢敤浜?token 鍒锋柊锛? */
export async function verifyTokenForRefresh(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      issuer: ISSUER,
      clockTolerance: 3600,
    });
if (isTokenRevoked(token)) return null;
    const obj = payload as unknown as Partial<TokenPayload>;
    if (!obj.deviceId || !obj.sessionId || !obj.role) return null;
    return {
      deviceId: obj.deviceId,
      sessionId: obj.sessionId,
      role: obj.role,
      namespace: normalizeNamespace(obj.namespace || DEFAULT_NAMESPACE),
      protocolVersion: obj.protocolVersion || "0.0.0",
    };
  } catch {
    return null;
  }
}


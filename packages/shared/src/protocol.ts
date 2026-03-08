export const PROTOCOL_VERSION = "1.0.0";
export const DEFAULT_NAMESPACE = "default";

export interface ProtocolCompatibility {
  ok: boolean;
  reason?: string;
}

export function normalizeNamespace(value?: string): string {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_NAMESPACE;
  return raw;
}

function getMajor(version: string): number | null {
  const m = version.trim().match(/^(\d+)\./);
  if (!m) return null;
  return Number(m[1]);
}

export function isProtocolCompatible(
  clientVersion: string | undefined,
  serverVersion: string = PROTOCOL_VERSION,
): ProtocolCompatibility {
  if (!clientVersion) {
    // 兼容旧客户端：未上报版本时按兼容处理
    return { ok: true, reason: "legacy client (no protocol version)" };
  }
  const clientMajor = getMajor(clientVersion);
  const serverMajor = getMajor(serverVersion);
  if (clientMajor === null || serverMajor === null) {
    return { ok: false, reason: `invalid protocol version format (${clientVersion} / ${serverVersion})` };
  }
  if (clientMajor !== serverMajor) {
    return {
      ok: false,
      reason: `major mismatch (client=${clientVersion}, server=${serverVersion})`,
    };
  }
  return { ok: true };
}

export interface ParsedNamespaceToken {
  baseToken: string;
  namespace: string;
}

/**
 * 兼容 base:namespace 格式。
 * 若不带命名空间后缀，默认 namespace=default。
 */
export function parseNamespaceToken(raw: string): ParsedNamespaceToken | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const sep = trimmed.lastIndexOf(":");
  if (sep === -1) {
    return { baseToken: trimmed, namespace: DEFAULT_NAMESPACE };
  }
  const baseToken = trimmed.slice(0, sep).trim();
  const namespace = normalizeNamespace(trimmed.slice(sep + 1));
  if (!baseToken || !namespace) return null;
  return { baseToken, namespace };
}

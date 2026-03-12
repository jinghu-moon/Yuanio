import { isProtocolCompatible, normalizeNamespace, PROTOCOL_VERSION } from "@yuanio/shared";
import { WsHelloFrameSchema } from "@yuanio/shared";
import type { TokenPayload } from "./jwt";

export type WsHelloValidationResult =
  | { ok: true; payload: TokenPayload; protocolVersion: string; namespace: string }
  | { ok: false; error: string };

type HelloArgs = {
  frame: unknown;
  requireProtocolVersion: boolean;
  serverVersion?: string;
  verifyToken: (token: string) => Promise<TokenPayload | null>;
};

export async function validateWsHelloFrame(args: HelloArgs): Promise<WsHelloValidationResult> {
  const { frame, requireProtocolVersion, verifyToken } = args;
  const serverVersion = args.serverVersion ?? PROTOCOL_VERSION;
  const parsedResult = WsHelloFrameSchema.safeParse(frame);
  if (!parsedResult.success) {
    const tokenIssue = parsedResult.error.issues.find((issue) => issue.path.join(".") === "data.token");
    if (tokenIssue && tokenIssue.code === "invalid_type" && tokenIssue.received === "undefined") {
      return { ok: false, error: "token required" };
    }
    return { ok: false, error: "invalid hello frame" };
  }
  const parsed = parsedResult.data;
  const { token, protocolVersion, namespace } = parsed.data;
  if (!token) return { ok: false, error: "token required" };
  if (requireProtocolVersion && !protocolVersion) {
    return { ok: false, error: "protocol version required" };
  }
  const compat = isProtocolCompatible(protocolVersion, serverVersion);
  if (!compat.ok) {
    return { ok: false, error: `protocol mismatch: ${compat.reason ?? "unknown"}` };
  }
  const payload = await verifyToken(token);
  if (!payload) return { ok: false, error: "invalid or expired token" };
  return {
    ok: true,
    payload,
    protocolVersion: protocolVersion ?? serverVersion,
    namespace: normalizeNamespace(namespace ?? payload.namespace),
  };
}

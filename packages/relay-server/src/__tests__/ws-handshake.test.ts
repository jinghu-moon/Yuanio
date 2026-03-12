import { describe, expect, it } from "bun:test";
import { validateWsHelloFrame } from "../ws-handshake";
import type { TokenPayload } from "../jwt";

const basePayload: TokenPayload = {
  deviceId: "dev_1",
  sessionId: "sess_1",
  role: "app",
  namespace: "default",
  protocolVersion: "1.0.0",
};

const verifyTokenOk = async (token: string): Promise<TokenPayload | null> => {
  if (!token) return null;
  return { ...basePayload };
};

describe("ws handshake", () => {
  it("missing token should be rejected", async () => {
    const result = await validateWsHelloFrame({
      frame: { type: "hello", data: { protocolVersion: "1.0.0" } },
      requireProtocolVersion: true,
      serverVersion: "1.0.0",
      verifyToken: verifyTokenOk,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("token required");
  });

  it("protocol mismatch should be rejected", async () => {
    const result = await validateWsHelloFrame({
      frame: { type: "hello", data: { token: "tok", protocolVersion: "2.0.0" } },
      requireProtocolVersion: true,
      serverVersion: "1.0.0",
      verifyToken: verifyTokenOk,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("protocol mismatch");
  });

  it("valid hello should pass", async () => {
    const result = await validateWsHelloFrame({
      frame: {
        type: "hello",
        data: {
          token: "tok",
          protocolVersion: "1.0.0",
          namespace: "default",
          deviceId: "dev_1",
          role: "app",
        },
      },
      requireProtocolVersion: true,
      serverVersion: "1.0.0",
      verifyToken: verifyTokenOk,
    });
    expect(result.ok).toBe(true);
  });
});

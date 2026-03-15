import { describe, expect, it } from "bun:test";
import { MAX_ENVELOPE_BINARY_PAYLOAD_BYTES } from "../generated/relay-protocol";

type WsModule = Record<string, unknown>;

async function loadWsModule(): Promise<WsModule> {
  return (await import("../schemas")) as WsModule;
}

describe("ws protocol schema", () => {
  it("应暴露 WsFrameSchema 等核心导出", async () => {
    const mod = await loadWsModule();
    expect(mod.WsFrameSchema).toBeDefined();
    expect(mod.WsHelloPayloadSchema).toBeDefined();
    expect(mod.WsPresencePayloadSchema).toBeDefined();
  });

  it("hello frame 应通过 schema 校验", async () => {
    const mod = await loadWsModule();
    const schema = mod.WsFrameSchema as { parse?: (value: unknown) => unknown } | undefined;
    if (!schema?.parse) throw new Error("WsFrameSchema missing");
    const parsed = schema.parse({
      type: "hello",
      data: {
        token: "tok_1",
        protocolVersion: "1.0.0",
        namespace: "default",
        deviceId: "dev_1",
        role: "app",
      },
    }) as { type: string };
    expect(parsed.type).toBe("hello");
  });

  it("message frame 应包含 Envelope 数据", async () => {
    const mod = await loadWsModule();
    const schema = mod.WsFrameSchema as { parse?: (value: unknown) => unknown } | undefined;
    if (!schema?.parse) throw new Error("WsFrameSchema missing");
    const parsed = schema.parse({
      type: "message",
      data: {
        id: "msg_1",
        seq: 1,
        source: "app",
        target: "agent",
        sessionId: "sess_1",
        type: "prompt",
        ts: Date.now(),
        payload: "hello",
      },
    }) as { type: string };
    expect(parsed.type).toBe("message");
  });
  it("message frame 支持 Buffer JSON binary payload", async () => {
    const mod = await loadWsModule();
    const schema = mod.WsFrameSchema as { parse?: (value: unknown) => unknown } | undefined;
    if (!schema?.parse) throw new Error("WsFrameSchema missing");
    const parsed = schema.parse({
      type: "message",
      data: {
        id: "msg_bin_1",
        seq: 2,
        source: "app",
        target: "agent",
        sessionId: "sess_1",
        type: "pty_output",
        ts: Date.now(),
        payload: {
          type: "Buffer",
          data: [1, 2, 3, 255],
        },
      },
    }) as { type: string };
    expect(parsed.type).toBe("message");
  });

  it("message frame 支持 Uint8Array binary payload", async () => {
    const mod = await loadWsModule();
    const schema = mod.WsFrameSchema as { parse?: (value: unknown) => unknown } | undefined;
    if (!schema?.parse) throw new Error("WsFrameSchema missing");
    const parsed = schema.parse({
      type: "message",
      data: {
        id: "msg_bin_2",
        seq: 3,
        source: "app",
        target: "agent",
        sessionId: "sess_1",
        type: "pty_output",
        ts: Date.now(),
        payload: new Uint8Array([7, 8, 9]),
      },
    }) as { type: string };
    expect(parsed.type).toBe("message");
  });

  it("message frame 应拒绝超限 binary payload", async () => {
    const mod = await loadWsModule();
    const schema = mod.WsFrameSchema as { parse?: (value: unknown) => unknown } | undefined;
    if (!schema?.parse) throw new Error("WsFrameSchema missing");
    const oversized = new Uint8Array(MAX_ENVELOPE_BINARY_PAYLOAD_BYTES + 1);
    expect(() => {
      schema.parse({
        type: "message",
        data: {
          id: "msg_bin_3",
          seq: 4,
          source: "app",
          target: "agent",
          sessionId: "sess_1",
          type: "pty_output",
          ts: Date.now(),
          payload: oversized,
        },
      });
    }).toThrow();
  });
});


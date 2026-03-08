import { describe, it, expect } from "bun:test";
import { createEnvelopeSender } from "../sender";
import type { LocalServer } from "../../local-server";
import type { RelayClient } from "../../relay-client";
import { MessageType, SeqCounter } from "@yuanio/shared";

const withEnv = async (key: string, value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
};

async function createKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

function createLocalServerStub(authenticatedCount: number, sink: unknown[]): LocalServer {
  return {
    broadcast: (env) => { sink.push(env); },
    updateSession: () => {},
    stop: () => {},
    port: 0,
    clientCount: authenticatedCount,
    authenticatedCount,
  };
}

describe("sender", () => {
  it("auto 模式优先本地直连", async () => {
    await withEnv("YUANIO_CHANNEL_MODE", "auto", async () => {
      const relaySent: unknown[] = [];
      const localSent: unknown[] = [];
      const relay: RelayClient = { send: (env) => { relaySent.push(env); } } as RelayClient;
      const localServer = createLocalServerStub(1, localSent);
      const sharedKey = await createKey();

      const { sendEnvelope } = createEnvelopeSender({
        relay,
        getLocalServer: () => localServer,
        deviceId: "d1",
        peerDeviceId: "d2",
        seq: new SeqCounter(),
        getSessionId: () => "s1",
        getSharedKey: () => sharedKey,
      });

      await sendEnvelope(MessageType.STATUS, "ok");
      expect(localSent.length).toBe(1);
      expect(relaySent.length).toBe(0);
    });
  });

  it("relay 模式只走中继", async () => {
    await withEnv("YUANIO_CHANNEL_MODE", "relay", async () => {
      const relaySent: unknown[] = [];
      const localSent: unknown[] = [];
      const relay: RelayClient = { send: (env) => { relaySent.push(env); } } as RelayClient;
      const localServer = createLocalServerStub(1, localSent);
      const sharedKey = await createKey();

      const { sendEnvelope } = createEnvelopeSender({
        relay,
        getLocalServer: () => localServer,
        deviceId: "d1",
        peerDeviceId: "d2",
        seq: new SeqCounter(),
        getSessionId: () => "s1",
        getSharedKey: () => sharedKey,
      });

      await sendEnvelope(MessageType.STATUS, "ok");
      expect(localSent.length).toBe(0);
      expect(relaySent.length).toBe(1);
    });
  });

  it("dual 模式双通道发送", async () => {
    await withEnv("YUANIO_CHANNEL_MODE", "dual", async () => {
      const relaySent: unknown[] = [];
      const localSent: unknown[] = [];
      const relay: RelayClient = { send: (env) => { relaySent.push(env); } } as RelayClient;
      const localServer = createLocalServerStub(1, localSent);
      const sharedKey = await createKey();

      const { sendEnvelope } = createEnvelopeSender({
        relay,
        getLocalServer: () => localServer,
        deviceId: "d1",
        peerDeviceId: "d2",
        seq: new SeqCounter(),
        getSessionId: () => "s1",
        getSharedKey: () => sharedKey,
      });

      await sendEnvelope(MessageType.STATUS, "ok");
      expect(localSent.length).toBe(1);
      expect(relaySent.length).toBe(1);
    });
  });
});

import {
  createEnvelopeWeb,
  createBinaryEnvelopeWeb,
  MessageType,
  SeqCounter,
} from "@yuanio/shared";
import type { LocalServer } from "../local-server";
import type { RelayClient } from "../relay-client";

type ChannelMode = "auto" | "dual" | "relay" | "local";

function resolveChannelMode(mode?: string): ChannelMode {
  if (mode === "dual" || mode === "relay" || mode === "local" || mode === "auto") return mode;
  return "auto";
}

export function createEnvelopeSender(params: {
  relay: RelayClient;
  getLocalServer: () => LocalServer | null;
  deviceId: string;
  peerDeviceId: string;
  seq: SeqCounter;
  getSessionId: () => string;
  getSharedKey: () => CryptoKey;
  channelMode?: ChannelMode;
}) {
  const mode = params.channelMode ?? resolveChannelMode(process.env.YUANIO_CHANNEL_MODE);

  const pickChannels = (localServer: LocalServer | null) => {
    const localAvailable = !!localServer && localServer.authenticatedCount > 0;
    if (mode === "relay") return { relay: true, local: false };
    if (mode === "local") return { relay: false, local: true };
    if (mode === "dual") return { relay: true, local: true };
    if (localAvailable) return { relay: false, local: true };
    return { relay: true, local: false };
  };

  const sendEnvelope = async (
    type: MessageType,
    plaintext: string,
    seqOverride?: number,
    ptyId?: string,
  ) => {
    const env = await createEnvelopeWeb(
      params.deviceId,
      params.peerDeviceId,
      params.getSessionId(),
      type,
      plaintext,
      params.getSharedKey(),
      seqOverride ?? params.seq.next(),
      ptyId,
    );
    const localServer = params.getLocalServer();
    const channels = pickChannels(localServer);
    if (channels.relay) {
      const envRelay = channels.local ? { ...env } : env;
      (envRelay as any)._via = "relay";
      params.relay.send(envRelay);
    }
    if (channels.local && localServer) {
      const envLocal = channels.relay ? { ...env } : env;
      (envLocal as any)._via = "local";
      localServer.broadcast(envLocal);
    }
  };

  const sendBinaryEnvelope = async (
    type: MessageType,
    plaintext: string,
    seqOverride?: number,
    ptyId?: string,
  ) => {
    const env = await createBinaryEnvelopeWeb(
      params.deviceId,
      params.peerDeviceId,
      params.getSessionId(),
      type,
      plaintext,
      params.getSharedKey(),
      seqOverride ?? params.seq.next(),
      ptyId,
    );
    const localServer = params.getLocalServer();
    const channels = pickChannels(localServer);
    if (channels.relay) {
      const envRelay = channels.local ? { ...env } : env;
      (envRelay as any)._via = "relay";
      params.relay.send(envRelay);
    }
    if (channels.local && localServer) {
      const envLocal = channels.relay ? { ...env } : env;
      (envLocal as any)._via = "local";
      localServer.broadcast(envLocal);
    }
  };

  return { sendEnvelope, sendBinaryEnvelope };
}

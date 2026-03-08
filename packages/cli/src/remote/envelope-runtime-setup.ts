import { MessageType } from "@yuanio/shared";
import type { MessageType as MessageTypeEnum } from "@yuanio/shared";
import type { Envelope, BinaryEnvelope } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import { createEnvelopeHandler } from "./envelope-handler";
import {
  createEnvelopeRoutingOptions,
  type CreateEnvelopeRoutingOptions,
} from "./envelope-routing-options";
import { createPendingDrainer } from "./pending";
import { bindPendingDrainToRelay } from "./relay-drain";

type RoutingOptionsWithoutRelay = Omit<CreateEnvelopeRoutingOptions, "relay">;

export interface CreateEnvelopeRuntimeSetupOptions {
  relay: RelayClient;
  routing: RoutingOptionsWithoutRelay;
  serverUrl: string;
  getSessionToken: () => string;
  sendEnvelope: (type: MessageTypeEnum, plaintext: string) => Promise<void>;
  getSessionId: () => string;
}

export function createEnvelopeRuntimeSetup(options: CreateEnvelopeRuntimeSetupOptions) {
  const handleEnvelope = createEnvelopeHandler(
    createEnvelopeRoutingOptions({
      relay: options.relay,
      ...options.routing,
    }),
  );

  options.relay.onMessage((envelope: Envelope | BinaryEnvelope) => {
    handleEnvelope(envelope).catch((e) => {
      console.error("[remote] 处理消息失败:", e?.message || e);
    });
  });

  const { drainPending } = createPendingDrainer({
    serverUrl: options.serverUrl,
    getSessionToken: options.getSessionToken,
    handleEnvelope,
    onDrainComplete: async (stats) => {
      await options.sendEnvelope(MessageType.REPLAY_DONE, JSON.stringify({
        sessionId: options.getSessionId(),
        replayed: stats.replayed,
        daemonCached: stats.daemonCached,
        rounds: stats.rounds,
        reason: stats.reason,
        at: Date.now(),
      }));
    },
  });

  bindPendingDrainToRelay(options.relay, drainPending);

  return {
    handleEnvelope,
    drainPending,
  };
}

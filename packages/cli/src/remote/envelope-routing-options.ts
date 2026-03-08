import { RpcReqPayloadSchema, safeParsePayload } from "@yuanio/shared";
import type { Envelope, BinaryEnvelope, IngressPromptSource } from "@yuanio/shared";
import type { InboundEnvelopeTracker } from "./inbound-tracker";
import type { CreateEnvelopeHandlerOptions } from "./envelope-handler";
import { handleControlEnvelope, type ControlRouterContext } from "./control-router";
import { handleNonPromptEnvelope, type NonPromptRouterContext } from "./non-prompt-router";
import { handleRpc, type RpcDeps } from "./rpc";
import type { RelayClient } from "../relay-client";
import type { DispatchPromptParams } from "./prompt-dispatch-runtime";

export interface CreateEnvelopeRoutingOptions {
  relay: RelayClient;
  deviceId: string;
  getSessionId: () => string;
  getSharedKey: () => CryptoKey;
  inboundTracker: InboundEnvelopeTracker;
  buildControlContext: () => ControlRouterContext;
  buildRpcDeps: () => RpcDeps;
  buildNonPromptContext: () => NonPromptRouterContext;
  resolvePromptSource: (envelope: Envelope | BinaryEnvelope) => IngressPromptSource;
  dispatchPrompt: (params: DispatchPromptParams) => Promise<void>;
}

export function createEnvelopeRoutingOptions(
  options: CreateEnvelopeRoutingOptions,
): CreateEnvelopeHandlerOptions {
  return {
    relay: options.relay,
    deviceId: options.deviceId,
    getSessionId: options.getSessionId,
    getSharedKey: options.getSharedKey,
    inboundTracker: options.inboundTracker,
    onControlEnvelope: (envelope, payload) => {
      return handleControlEnvelope(envelope, payload, options.buildControlContext());
    },
    onRpcEnvelope: async (_, payload) => {
      const rpc = safeParsePayload(RpcReqPayloadSchema, payload, "RPC_REQ");
      void handleRpc(rpc, options.buildRpcDeps());
    },
    onNonPromptEnvelope: (envelope, payload) => {
      return handleNonPromptEnvelope(envelope, payload, options.buildNonPromptContext());
    },
    onPromptEnvelope: async (envelope, payload) => {
      const source = options.resolvePromptSource(envelope);
      await options.dispatchPrompt({
        envelope: envelope as Envelope,
        payload,
        source,
      });
    },
  };
}

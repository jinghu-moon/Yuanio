import type { RelayClient } from "../relay-client";
import type { PendingDrainReason } from "./pending";

export function bindPendingDrainToRelay(
  relay: RelayClient,
  drainPending: (reason?: PendingDrainReason) => Promise<void>,
): void {
  relay.onConnectionChange((connected) => {
    if (connected) void drainPending("connect");
  });
  if (relay.connected) {
    void drainPending("startup");
  }
}

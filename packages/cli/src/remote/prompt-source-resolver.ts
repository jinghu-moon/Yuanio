import { resolveMobilePromptSource } from "@yuanio/shared";
import type { BinaryEnvelope, Envelope, IngressPromptSource } from "@yuanio/shared";

type NetworkMode = Parameters<typeof resolveMobilePromptSource>[0]["networkMode"];

export function createPromptSourceResolver(networkMode: NetworkMode) {
  return (envelope: Envelope | BinaryEnvelope): IngressPromptSource => {
    const via = typeof (envelope as { _via?: unknown })._via === "string"
      ? String((envelope as { _via?: unknown })._via).trim().toLowerCase()
      : "";
    return resolveMobilePromptSource({
      transportHint: via,
      networkMode,
    });
  };
}

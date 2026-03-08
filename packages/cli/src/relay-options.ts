import type { ManagerOptions, SocketOptions } from "socket.io-client";
import { PROTOCOL_VERSION } from "@yuanio/shared";

export const WEBSOCKET_ONLY_TRANSPORTS = ["websocket"] as const;
export const WEBSOCKET_FIRST_TRANSPORTS = WEBSOCKET_ONLY_TRANSPORTS;
export const POLLING_FIRST_TRANSPORTS = ["polling", "websocket"] as const;

type BaseRelaySocketOptions = Partial<ManagerOptions & SocketOptions>;
export type RelaySocketOptions = Omit<BaseRelaySocketOptions, "transports"> & {
  transports?: string[];
};

export function createRelaySocketOptions(sessionToken: string): RelaySocketOptions {
  return {
    auth: { token: sessionToken, protocolVersion: PROTOCOL_VERSION },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 300,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.2,
    timeout: 5000,
    rememberUpgrade: false,
    upgrade: false,
    transports: [...WEBSOCKET_ONLY_TRANSPORTS],
    tryAllTransports: false,
  };
}

export function ensurePollingFallback(
  opts: RelaySocketOptions,
  log?: (message: string) => void,
): boolean {
  // 延迟优先：不再自动回退 polling，避免引入长尾抖动。
  void opts;
  void log;
  return false;
}

export function toPollingFirstOptions(
  opts: RelaySocketOptions,
  log?: (message: string) => void,
): boolean {
  const transports = opts.transports;
  if (!Array.isArray(transports) || transports.length < 2) return false;
  if (transports[0] !== "websocket") return false;
  opts.rememberUpgrade = false;
  opts.transports = [...POLLING_FIRST_TRANSPORTS];
  log?.("[relay] WebSocket 首选失败，回退为 polling→websocket");
  return true;
}

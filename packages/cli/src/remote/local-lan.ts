import { startLocalServer, type LocalServer } from "../local-server";
import { publishService, unpublishService } from "../mdns";
import { loadKeys } from "../keystore";
import type { Envelope, BinaryEnvelope } from "@yuanio/shared";

const DEFAULT_PORTS = [9394, 9395, 9396];

function resolvePortCandidates(): number[] {
  const env = process.env.YUANIO_LOCAL_LAN_PORTS?.trim();
  if (!env) return DEFAULT_PORTS;
  const parsed = env.split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.floor(v));
  return parsed.length > 0 ? parsed : DEFAULT_PORTS;
}

export function startLocalLan(params: {
  sessionId: string;
  sharedKey: CryptoKey;
  deviceId: string;
  onEnvelope: (env: Envelope | BinaryEnvelope) => void;
  onClientChange?: (count: number) => void;
}): LocalServer | null {
  const keys = loadKeys();
  if (!keys?.secretKey || !keys.peerPublicKey) return null;

  const ports = resolvePortCandidates();
  let lastError = "";

  for (const port of ports) {
    try {
      const localServer = startLocalServer({
        port,
        mode: "full",
        sessionId: params.sessionId,
        sharedKey: params.sharedKey,
        secretKey: keys.secretKey,
        peerPublicKey: keys.peerPublicKey,
        deviceId: params.deviceId,
        onEnvelope: params.onEnvelope,
        onClientChange: params.onClientChange,
      });
      publishService(localServer.port, params.deviceId);
      if (port !== ports[0]) {
        console.warn(`[local] 端口 ${ports[0]} 已占用，回退到 ${port}`);
      }
      return localServer;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      const conflict = /in use|EADDRINUSE|address already in use/i.test(msg);
      if (!conflict) break;
    }
  }

  console.warn(`[local] 本地服务器启动失败: ${lastError || "unknown error"}`);
  return null;
}

export function registerLocalCleanup(localServer: LocalServer | null): void {
  const cleanup = () => {
    localServer?.stop();
    unpublishService();
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

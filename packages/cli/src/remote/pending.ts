import { fetchPendingEnvelopes } from "../pending";
import { fetchDaemonCachedMessages, clearDaemonCache } from "../daemon-client";
import type { Envelope, BinaryEnvelope } from "@yuanio/shared";

export type PendingDrainReason = "startup" | "connect" | "seq_gap" | "manual";

export interface PendingDrainStats {
  replayed: number;
  daemonCached: number;
  rounds: number;
  reason: PendingDrainReason;
}

export function createPendingDrainer(params: {
  serverUrl: string;
  getSessionToken: () => string;
  handleEnvelope: (env: Envelope | BinaryEnvelope) => Promise<void>;
  onDrainComplete?: (stats: PendingDrainStats) => Promise<void> | void;
}): { drainPending: (reason?: PendingDrainReason) => Promise<void> } {
  const pendingBatchLimit = 200;
  const maxDrainRounds = 20;
  let drainRunning = false;

  const drainDaemonCache = async (): Promise<number> => {
    const cached = await fetchDaemonCachedMessages();
    if (!cached || cached.messages.length === 0) return 0;
    console.log(`[remote] daemon 缓存消息: ${cached.messages.length} 条`);
    for (const env of cached.messages) {
      await params.handleEnvelope(env);
    }
    await clearDaemonCache(cached.baseUrl);
    return cached.messages.length;
  };

  const drainPending = async (reason: PendingDrainReason = "manual") => {
    if (drainRunning) return;
    drainRunning = true;
    try {
      const daemonCached = await drainDaemonCache();
      let total = 0;
      let rounds = 0;
      let previousSignature = "";
      let stalledRounds = 0;

      for (let round = 0; round < maxDrainRounds; round += 1) {
        rounds += 1;
        const pending = await fetchPendingEnvelopes(params.serverUrl, params.getSessionToken(), pendingBatchLimit);
        if (pending.length === 0) break;
        total += pending.length;
        if (round === 0) {
          console.log(`[remote] 待处理消息: ${pending.length} 条`);
        } else {
          console.log(`[remote] 待处理消息(续): ${pending.length} 条`);
        }

        const firstId = pending[0]?.id ?? "";
        const lastId = pending[pending.length - 1]?.id ?? "";
        const signature = `${firstId}:${lastId}:${pending.length}`;
        if (signature === previousSignature) {
          stalledRounds += 1;
          if (stalledRounds >= 2) {
            console.warn("[remote] pending 队列未前进，停止本轮 drain 以避免死循环");
            break;
          }
        } else {
          stalledRounds = 0;
          previousSignature = signature;
        }

        for (const env of pending) {
          await params.handleEnvelope(env);
        }
        if (pending.length < pendingBatchLimit) break;
        await new Promise<void>((resolveFn) => setTimeout(resolveFn, 30));
      }

      if (total > pendingBatchLimit) {
        console.log(`[remote] pending 已分批处理: ${total} 条`);
      }

      if (params.onDrainComplete && (total > 0 || daemonCached > 0)) {
        await params.onDrainComplete({
          replayed: total,
          daemonCached,
          rounds,
          reason,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[remote] pending 拉取失败:", msg);
    } finally {
      drainRunning = false;
    }
  };

  return { drainPending };
}

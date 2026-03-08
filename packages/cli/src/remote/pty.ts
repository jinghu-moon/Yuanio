import { MessageType } from "@yuanio/shared";
import type { PtySpawnPayload, PtyResizePayload, PtyAckPayload, PtyStatusPayload } from "@yuanio/shared";
import {
  spawnPty,
  writePty,
  resizePty,
  killPty,
  ackPty,
  getPtyMetrics,
  listPtyMetrics,
  type PtyMetrics,
} from "../pty-session";

const PTY_STATUS_INTERVAL = 5_000;
const PTY_WARN_BUFFERED_BYTES = (() => {
  const kb = Number(process.env.YUANIO_PTY_WARN_KB || "");
  const value = Number.isFinite(kb) && kb > 0 ? kb * 1024 : 256 * 1024;
  return value;
})();
const PTY_WARN_INTERVAL = 10_000;

export interface PtyController {
  handleSpawn: (payload: PtySpawnPayload, ptyId: string) => void;
  handleInput: (payload: string, ptyId: string) => void;
  handleResize: (payload: PtyResizePayload, ptyId: string) => void;
  handleKill: (ptyId: string) => void;
  handleAck: (payload: PtyAckPayload, ptyId: string) => void;
  sendStatus: (ptyId: string) => Promise<void>;
  stop: () => void;
}

export function createPtyController(
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>,
  sendBinaryEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>,
): PtyController {
  let ptyStatusTimer: Timer | null = null;
  const lastWarnAt = new Map<string, number>();

  const toStatusPayload = (m: PtyMetrics): PtyStatusPayload => ({
    pid: m.pid,
    startedAt: m.startedAt,
    lastActiveAt: m.lastActiveAt,
    cols: m.cols,
    rows: m.rows,
    bufferedBytes: m.bufferedBytes,
    paused: m.paused,
  });

  const sendPtyStatus = async (ptyId: string) => {
    const metrics = getPtyMetrics(ptyId);
    if (!metrics) return;
    maybeWarn(metrics);
    await sendEnvelope(MessageType.PTY_STATUS, JSON.stringify(toStatusPayload(metrics)), undefined, ptyId);
  };

  const ensurePtyStatusTimer = () => {
    if (ptyStatusTimer) return;
    ptyStatusTimer = setInterval(() => {
      const metrics = listPtyMetrics();
      if (metrics.length === 0) {
        if (ptyStatusTimer) clearInterval(ptyStatusTimer);
        ptyStatusTimer = null;
        return;
      }
      for (const m of metrics) {
        maybeWarn(m);
        void sendEnvelope(MessageType.PTY_STATUS, JSON.stringify(toStatusPayload(m)), undefined, m.ptyId);
      }
    }, PTY_STATUS_INTERVAL);
  };

  const maybeWarn = (m: PtyMetrics) => {
    if (m.bufferedBytes < PTY_WARN_BUFFERED_BYTES) return;
    const now = Date.now();
    const last = lastWarnAt.get(m.ptyId) || 0;
    if (now - last < PTY_WARN_INTERVAL) return;
    lastWarnAt.set(m.ptyId, now);
    console.warn(`[pty-flow] high buffer ${m.ptyId}: ${(m.bufferedBytes / 1024).toFixed(0)}KB`);
  };

  return {
    handleSpawn: (payload, ptyId) => {
      spawnPty(ptyId, payload.cols, payload.rows, (data) => {
        void sendBinaryEnvelope(MessageType.PTY_OUTPUT, data, undefined, ptyId);
      }, (code) => {
        void sendBinaryEnvelope(MessageType.PTY_EXIT, JSON.stringify({ code }), undefined, ptyId);
      }, payload.shell, payload.cwd);
      ensurePtyStatusTimer();
      void sendPtyStatus(ptyId);
    },
    handleInput: (payload, ptyId) => {
      writePty(ptyId, payload);
    },
    handleResize: (payload, ptyId) => {
      resizePty(ptyId, payload.cols, payload.rows);
    },
    handleKill: (ptyId) => {
      killPty(ptyId);
    },
    handleAck: (payload, ptyId) => {
      ackPty(ptyId, payload.bytes);
    },
    sendStatus: sendPtyStatus,
    stop: () => {
      if (ptyStatusTimer) clearInterval(ptyStatusTimer);
      ptyStatusTimer = null;
    },
  };
}

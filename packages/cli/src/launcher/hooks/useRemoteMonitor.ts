import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_E2EE_INFO,
  deriveAesGcmKey,
  deriveSharedKey,
  openEnvelope,
  openEnvelopeWeb,
  type Envelope,
} from "@yuanio/shared";
import { loadKeys, type StoredKeys } from "@/keystore";
import { RelayClient } from "@/relay-client";
import { isTextEnvelope } from "@/relay-options";
import type { LauncherI18n } from "../i18n/index.ts";

const SESSION_POLL_INTERVAL_MS = 3000;
const MESSAGE_POLL_INTERVAL_MS = 5000;
const MAX_LINES = 2000;

type CryptoContext =
  | {
      mode: "webcrypto";
      sessionId: string;
      privateKey: string;
      peerPublicKey: string;
      key: CryptoKey;
    }
  | {
      mode: "nacl";
      secretKey: string;
      peerPublicKey: string;
      key: Uint8Array;
    };

export interface MonitorSession {
  sessionId: string;
  role: string;
  onlineCount: number;
  hasAgentOnline: boolean;
  hasAppOnline: boolean;
}

export interface MonitorLine {
  id: string;
  ts: number;
  type: string;
  text: string;
}

interface SessionsResponse {
  currentSessionId?: string;
  sessions?: Array<{
    sessionId: string;
    role?: string;
    onlineCount?: number;
    hasAgentOnline?: boolean;
    hasAppOnline?: boolean;
  }>;
}

interface MessagesResponse {
  messages?: Array<Record<string, unknown>>;
}

export interface RemoteMonitorState {
  ready: boolean;
  status: string;
  error: string | null;
  sessions: MonitorSession[];
  currentSessionId: string | null;
  selectedSessionId: string | null;
  lines: MonitorLine[];
  readonlySelection: boolean;
  setSelectedSessionId: (sessionId: string) => void;
  clearSelectedLines: () => void;
  refreshNow: () => Promise<void>;
}

function normalizeSessionList(payload: SessionsResponse, unknownRole: string): MonitorSession[] {
  return (payload.sessions ?? []).map((item) => ({
    sessionId: item.sessionId,
    role: item.role ?? unknownRole,
    onlineCount: item.onlineCount ?? 0,
    hasAgentOnline: item.hasAgentOnline ?? false,
    hasAppOnline: item.hasAppOnline ?? false,
  }));
}

function normalizeEnvelope(row: Record<string, unknown>, fallbackSessionId: string): Envelope | null {
  const payload = row.payload;
  if (typeof payload !== "string" || payload.length === 0) return null;
  const id = String(row.id ?? "");
  if (!id) return null;

  const tsNum = Number(row.ts ?? Date.now());
  const seqNum = Number(row.seq ?? 0);
  const sessionIdRaw = row.session_id ?? row.sessionId ?? fallbackSessionId;
  const ptyIdRaw = row.pty_id ?? row.ptyId;

  return {
    id,
    seq: Number.isFinite(seqNum) ? seqNum : 0,
    source: String(row.source ?? ""),
    target: String(row.target ?? ""),
    sessionId: String(sessionIdRaw ?? fallbackSessionId),
    type: String(row.type ?? "unknown") as any,
    ts: Number.isFinite(tsNum) ? tsNum : Date.now(),
    payload,
    ptyId: typeof ptyIdRaw === "string" && ptyIdRaw ? ptyIdRaw : undefined,
  };
}

function formatPayload(payload: string): string {
  const flattened = payload.replace(/\r?\n/g, "\\n");
  return flattened.length > 300 ? `${flattened.slice(0, 300)}...` : flattened;
}

async function getCryptoContext(
  cache: CryptoContext | null,
  keys: StoredKeys,
  sessionId: string,
): Promise<CryptoContext> {
  if (keys.cryptoVersion === "webcrypto") {
    if (
      cache?.mode === "webcrypto" &&
      cache.sessionId === sessionId &&
      cache.privateKey === keys.secretKey &&
      cache.peerPublicKey === keys.peerPublicKey
    ) {
      return cache;
    }
    const key = await deriveAesGcmKey({
      privateKey: keys.secretKey,
      publicKey: keys.peerPublicKey,
      salt: sessionId,
      info: DEFAULT_E2EE_INFO,
    });
    return {
      mode: "webcrypto",
      sessionId,
      privateKey: keys.secretKey,
      peerPublicKey: keys.peerPublicKey,
      key,
    };
  }

  if (
    cache?.mode === "nacl" &&
    cache.secretKey === keys.secretKey &&
    cache.peerPublicKey === keys.peerPublicKey
  ) {
    return cache;
  }
  return {
    mode: "nacl",
    secretKey: keys.secretKey,
    peerPublicKey: keys.peerPublicKey,
    key: deriveSharedKey(keys.secretKey, keys.peerPublicKey),
  };
}

export function useRemoteMonitor(active: boolean, i18n: LauncherI18n): RemoteMonitorState {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(i18n.t("monitor.status.waiting_connection"));
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MonitorSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionIdState] = useState<string | null>(null);
  const [lines, setLines] = useState<MonitorLine[]>([]);

  const currentSessionRef = useRef<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const cryptoCacheRef = useRef<CryptoContext | null>(null);
  const logsRef = useRef<Map<string, MonitorLine[]>>(new Map());
  const seenIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const afterTsRef = useRef<Map<string, number>>(new Map());
  const pollingRef = useRef({ sessions: false, messages: false });
  const relayRef = useRef<RelayClient | null>(null);

  const applySelectedSession = useCallback((sessionId: string | null) => {
    selectedSessionRef.current = sessionId;
    setSelectedSessionIdState(sessionId);
    setLines(sessionId ? logsRef.current.get(sessionId) ?? [] : []);
  }, []);

  const fetchSessions = useCallback(async () => {
    if (pollingRef.current.sessions) return;
    pollingRef.current.sessions = true;
    try {
      const keys = loadKeys();
      if (!keys) {
        setReady(false);
        setStatus(i18n.t("monitor.status.no_keys"));
        setError(null);
        setSessions([]);
        setCurrentSessionId(null);
        applySelectedSession(null);
        return;
      }

      const res = await fetch(`${keys.serverUrl}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${keys.sessionToken}` },
      });
      if (!res.ok) {
        throw new Error(i18n.t("monitor.error.fetch_sessions", { status: res.status }));
      }

      const payload = await res.json() as SessionsResponse;
      const list = normalizeSessionList(payload, i18n.t("monitor.role.unknown"));
      const nextCurrent = payload.currentSessionId || keys.sessionId || null;

      setReady(true);
      setSessions(list);
      setCurrentSessionId(nextCurrent);
      currentSessionRef.current = nextCurrent;

      const selected = selectedSessionRef.current;
      const selectedExists = !!selected && list.some((s) => s.sessionId === selected);
      if (!selectedExists) {
        const fallback = nextCurrent || list[0]?.sessionId || null;
        applySelectedSession(fallback);
      } else if (selected) {
        setLines(logsRef.current.get(selected) ?? []);
      }

      setError(null);
      setStatus(i18n.t("monitor.status.connected", { count: list.length }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pollingRef.current.sessions = false;
    }
  }, [applySelectedSession, i18n]);

  const fetchMessages = useCallback(async () => {
    if (pollingRef.current.messages) return;
    pollingRef.current.messages = true;
    try {
      const keys = loadKeys();
      if (!keys) return;

      const sessionId = currentSessionRef.current || keys.sessionId;
      if (!sessionId) return;

      const afterTs = afterTsRef.current.get(sessionId) ?? 0;
      const res = await fetch(
        `${keys.serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?after=${afterTs}&limit=200`,
        { headers: { Authorization: `Bearer ${keys.sessionToken}` } },
      );
      if (!res.ok) {
        throw new Error(i18n.t("monitor.error.fetch_messages", { status: res.status }));
      }

      const payload = await res.json() as MessagesResponse;
      const rows = payload.messages ?? [];
      if (rows.length === 0) return;

      const cryptoCtx = await getCryptoContext(cryptoCacheRef.current, keys, sessionId);
      cryptoCacheRef.current = cryptoCtx;

      const seen = seenIdsRef.current.get(sessionId) ?? new Set<string>();
      const appended: MonitorLine[] = [];
      let maxTs = afterTs;

      for (const row of rows) {
        const env = normalizeEnvelope(row, sessionId);
        if (!env || seen.has(env.id)) continue;
        seen.add(env.id);
        if (env.ts > maxTs) maxTs = env.ts;

        try {
          const plaintext = cryptoCtx.mode === "webcrypto"
            ? await openEnvelopeWeb(env, cryptoCtx.key)
            : openEnvelope(env, cryptoCtx.key);
          appended.push({
            id: env.id,
            ts: env.ts,
            type: env.type,
            text: formatPayload(plaintext),
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          appended.push({
            id: env.id,
            ts: env.ts,
            type: env.type,
            text: i18n.t("monitor.error.decrypt", { message: msg }),
          });
        }
      }

      seenIdsRef.current.set(sessionId, seen);
      afterTsRef.current.set(sessionId, maxTs);

      if (appended.length > 0) {
        const prev = logsRef.current.get(sessionId) ?? [];
        const next = [...prev, ...appended].slice(-MAX_LINES);
        logsRef.current.set(sessionId, next);
        if (selectedSessionRef.current === sessionId) {
          setLines(next);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pollingRef.current.messages = false;
    }
  }, [i18n]);

  const clearSelectedLines = useCallback(() => {
    const sessionId = selectedSessionRef.current;
    if (!sessionId) return;
    logsRef.current.set(sessionId, []);
    seenIdsRef.current.set(sessionId, new Set<string>());
    if (selectedSessionRef.current === sessionId) {
      setLines([]);
    }
  }, []);

  const setSelectedSessionId = useCallback((sessionId: string) => {
    applySelectedSession(sessionId);
  }, [applySelectedSession]);

  const refreshNow = useCallback(async () => {
    await fetchSessions();
    await fetchMessages();
  }, [fetchMessages, fetchSessions]);

  const appendLine = useCallback((sessionId: string, line: MonitorLine) => {
    const seen = seenIdsRef.current.get(sessionId) ?? new Set<string>();
    if (seen.has(line.id)) return;
    seen.add(line.id);
    seenIdsRef.current.set(sessionId, seen);
    const maxTs = Math.max(afterTsRef.current.get(sessionId) ?? 0, line.ts);
    afterTsRef.current.set(sessionId, maxTs);

    const prev = logsRef.current.get(sessionId) ?? [];
    const next = [...prev, line].slice(-MAX_LINES);
    logsRef.current.set(sessionId, next);
    if (selectedSessionRef.current === sessionId) {
      setLines(next);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const keys = loadKeys();
    if (!keys) return;

    const relay = new RelayClient(keys.serverUrl, keys.sessionToken);
    relayRef.current = relay;

    relay.onConnectionChange((connected) => {
      if (!connected) return;
      const realtime = i18n.t("monitor.status.realtime_connected");
      setStatus((prev) => (prev.includes(realtime) ? prev : `${prev} · ${realtime}`));
      setError(null);
    });

    relay.onError((message) => {
      setError(i18n.t("monitor.error.realtime_sub", { message }));
    });

    relay.onMessage((env) => {
      if (!isTextEnvelope(env)) return;
      void (async () => {
        try {
          const cryptoCtx = await getCryptoContext(cryptoCacheRef.current, keys, env.sessionId);
          cryptoCacheRef.current = cryptoCtx;
          const plaintext = cryptoCtx.mode === "webcrypto"
            ? await openEnvelopeWeb(env, cryptoCtx.key)
            : openEnvelope(env, cryptoCtx.key);
          appendLine(env.sessionId, {
            id: env.id,
            ts: env.ts,
            type: env.type,
            text: formatPayload(plaintext),
          });
        } catch {
          // 忽略非当前会话或密钥不匹配导致的解密失败
        }
      })();
    });

    return () => {
      relay.disconnect();
      if (relayRef.current === relay) relayRef.current = null;
    };
  }, [active, appendLine, i18n]);

  useEffect(() => {
    if (!active) return;
    void refreshNow();
    const sessionsTimer = setInterval(() => { void fetchSessions(); }, SESSION_POLL_INTERVAL_MS);
    const messagesTimer = setInterval(() => { void fetchMessages(); }, MESSAGE_POLL_INTERVAL_MS);
    return () => {
      clearInterval(sessionsTimer);
      clearInterval(messagesTimer);
    };
  }, [active, fetchMessages, fetchSessions, refreshNow]);

  return {
    ready,
    status,
    error,
    sessions,
    currentSessionId,
    selectedSessionId,
    lines,
    readonlySelection: !!selectedSessionId && !!currentSessionId && selectedSessionId !== currentSessionId,
    setSelectedSessionId,
    clearSelectedLines,
    refreshNow,
  };
}

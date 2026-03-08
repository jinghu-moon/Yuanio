import { useState, useCallback, useEffect, useRef } from "react";
import type { ServiceInfo } from "./useServices.ts";

interface Session {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
}

interface DaemonClient {
  sessions: Session[];
  healthy: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  spawnSession: (agent: string, prompt: string, dir?: string) => Promise<void>;
  stopSession: (id: string) => Promise<void>;
}

export function useDaemon(daemonInfo: ServiceInfo & { port?: number }): DaemonClient {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [healthy, setHealthy] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const baseUrl = `http://localhost:${daemonInfo.port || 9394}`;

  const refresh = useCallback(async () => {
    if (daemonInfo.status !== "running") return;
    try {
      const res = await fetch(`${baseUrl}/sessions/list`);
      if (res.ok) {
        const data = await res.json() as { sessions: Session[] };
        setSessions(data.sessions || []);
      }
    } catch {}
  }, [baseUrl, daemonInfo.status]);

  const checkHealth = useCallback(async () => {
    if (daemonInfo.status !== "running") {
      setHealthy(false);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      setHealthy(res.ok);
    } catch {
      setHealthy(false);
    }
  }, [baseUrl, daemonInfo.status]);

  // 轮询刷新
  useEffect(() => {
    if (daemonInfo.status !== "running") {
      setHealthy(false);
      setSessions([]);
      return;
    }
    checkHealth();
    refresh();
    timerRef.current = setInterval(() => {
      checkHealth();
      refresh();
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [daemonInfo.status]);

  const spawnSession = useCallback(async (agent: string, prompt: string, dir?: string) => {
    setLoading(true);
    try {
      await fetch(`${baseUrl}/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, prompt, directory: dir || process.cwd() }),
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [baseUrl, refresh]);

  const stopSession = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await fetch(`${baseUrl}/sessions/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [baseUrl, refresh]);

  return { sessions, healthy, loading, refresh, spawnSession, stopSession };
}

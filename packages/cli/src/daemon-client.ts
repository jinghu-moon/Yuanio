import type { Envelope } from "@yuanio/shared";
import { readState } from "./daemon";

export async function fetchDaemonCachedMessages(): Promise<{
  baseUrl: string;
  messages: Envelope[];
} | null> {
  const state = readState();
  if (!state) return null;

  const baseUrl = `http://127.0.0.1:${state.port}`;
  try {
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) return null;
  } catch {
    return null;
  }

  const msgRes = await fetch(`${baseUrl}/messages`);
  if (!msgRes.ok) return null;
  const data = await msgRes.json() as { messages?: any[] };
  const list = Array.isArray(data?.messages) ? data.messages : [];
  const messages = list.map((item) => (item?.envelope ? item.envelope : item)) as Envelope[];
  return { baseUrl, messages };
}

export async function clearDaemonCache(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/messages/clear`, { method: "POST" });
  } catch {
    // ignore
  }
}

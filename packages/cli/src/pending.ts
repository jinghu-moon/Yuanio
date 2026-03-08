import type { Envelope } from "@yuanio/shared";

export async function fetchPendingEnvelopes(
  serverUrl: string,
  sessionToken: string,
  limit: number = 100,
): Promise<Envelope[]> {
  const res = await fetch(`${serverUrl}/api/v1/queue/pending?limit=${limit}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    throw new Error(`pending fetch failed: ${res.status}`);
  }
  const data = await res.json() as { messages?: Envelope[] };
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages;
}

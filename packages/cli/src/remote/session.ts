import { deriveAesGcmKey, DEFAULT_E2EE_INFO, MessageType } from "@yuanio/shared";
import type { SessionSwitchPayload, SessionSwitchAckPayload, AgentStatus } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { LocalServer } from "../local-server";
import type { AgentHandle, AgentType } from "../spawn";
import { loadKeys, saveKeys } from "../keystore";

export async function handleSessionSwitch(
  payload: SessionSwitchPayload,
  deps: {
    deviceId: string;
    relay: RelayClient;
    localServer: LocalServer | null;
    runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
    processedPromptIds: Map<string, number>;
    sendStatus: (s: AgentStatus, reason?: string, force?: boolean) => Promise<void> | void;
    updateSession: (sessionId: string, sessionToken: string, sharedKey: CryptoKey) => void;
    sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>;
  },
): Promise<void> {
  const newSessionId = payload.sessionId;
  const newToken = payload.tokens?.[deps.deviceId];
  if (!newSessionId || !newToken) {
    console.warn("[remote] session_switch 缺少 token，已忽略");
    return;
  }
  const keys = loadKeys();
  if (!keys?.secretKey || !keys.peerPublicKey) {
    console.error("[remote] 缺少密钥材料，无法切换会话");
    return;
  }

  const newSharedKey = await deriveAesGcmKey({
    privateKey: keys.secretKey,
    publicKey: keys.peerPublicKey,
    salt: newSessionId,
    info: DEFAULT_E2EE_INFO,
  });

  saveKeys({
    ...keys,
    sessionId: newSessionId,
    sessionToken: newToken,
  });

  for (const [id, { handle }] of deps.runningAgents) {
    handle.kill();
    console.log(`[remote] 切换会话，中止任务 ${id}`);
  }
  deps.runningAgents.clear();
  deps.processedPromptIds.clear();
  await deps.sendStatus("idle", "session_switch", true);

  deps.updateSession(newSessionId, newToken, newSharedKey);

  deps.localServer?.updateSession(newSessionId, newSharedKey);

  deps.relay.reconnect(newToken);
  const ack: SessionSwitchAckPayload = {
    sessionId: newSessionId,
    deviceId: deps.deviceId,
    role: "agent",
  };
  await deps.sendEnvelope(MessageType.SESSION_SWITCH_ACK, JSON.stringify(ack));
  console.log(`[remote] 已切换会话: ${newSessionId}`);
}

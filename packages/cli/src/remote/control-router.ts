import {
  ForegroundProbePayloadSchema,
  MessageType,
  ModelModePayloadSchema,
  NewSessionPayloadSchema,
  PermissionModePayloadSchema,
  RpcRegisterPayloadSchema,
  RpcUnregisterPayloadSchema,
  SessionSwitchPayloadSchema,
  safeParsePayload,
} from "@yuanio/shared";
import type {
  AgentStatus,
  BinaryEnvelope,
  Envelope,
  ModelMode,
  NewSessionPayload,
  PermissionMode,
  SessionSwitchAckPayload,
} from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import type { LocalServer } from "../local-server";
import type { AgentHandle, AgentType } from "../spawn";
import { handleSessionSwitch } from "./session";
import { rpcRegistry } from "./rpc";

type HookEventContext = {
  event: string;
  sessionId: string;
  cwd: string;
  agent?: AgentType;
  mode?: ModelMode;
};

export interface ControlRouterContext {
  deviceId: string;
  relay: RelayClient;
  localServer: LocalServer | null;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  processedPromptIds: Map<string, number>;
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>;
  sendStatus: (s: AgentStatus, reason?: string, force?: boolean) => Promise<void> | void;
  updateSession: (sessionId: string, sessionToken: string, sharedKey: CryptoKey) => void;
  setDefaultAgent: (agent: AgentType) => void;
  getDefaultAgent: () => AgentType;
  getSessionId: () => string;
  getPermissionMode: () => PermissionMode;
  getModelMode: () => ModelMode;
  setModelMode: (mode: ModelMode) => void;
  setPermissionModeByRpc: (
    mode: PermissionMode,
    source?: "telegram" | "app" | "system",
  ) => Promise<string>;
  getForegroundProbeSnapshot: () => {
    sessionId: string;
    status: AgentStatus;
    cwd: string;
    turnStateVersion: number;
    turnStateReason: string;
    runningTasks: number;
    pendingApprovals: number;
    permissionMode: PermissionMode;
    modelMode?: ModelMode;
    lastOutboundSeq?: number;
  };
  refreshProjectScopedConfig: () => void;
  runConfigChangeHook: (ctx: HookEventContext) => Promise<void>;
  emitModelModeChanged: (mode: ModelMode) => void;
  heartbeatTick: () => Promise<void>;
}

export async function handleControlEnvelope(
  envelope: Envelope | BinaryEnvelope,
  payload: string,
  ctx: ControlRouterContext,
): Promise<boolean> {
  if (envelope.type === MessageType.NEW_SESSION) {
    const req = safeParsePayload(NewSessionPayloadSchema, payload, "NEW_SESSION");
    await handleNewSession(req, ctx);
    return true;
  }

  if (envelope.type === MessageType.SESSION_SWITCH) {
    const sw = safeParsePayload(SessionSwitchPayloadSchema, payload, "SESSION_SWITCH");
    await handleSessionSwitch(sw, {
      deviceId: ctx.deviceId,
      relay: ctx.relay,
      localServer: ctx.localServer,
      runningAgents: ctx.runningAgents,
      processedPromptIds: ctx.processedPromptIds,
      sendStatus: (s, reason, force) => ctx.sendStatus(s, reason, force),
      updateSession: ctx.updateSession,
      sendEnvelope: ctx.sendEnvelope,
    });
    return true;
  }

  if (envelope.type === MessageType.SESSION_SWITCH_ACK) {
    const ack: SessionSwitchAckPayload = JSON.parse(payload);
    console.log(`[remote] session_switch_ack from ${ack.deviceId} (${ack.role})`);
    return true;
  }

  if (envelope.type === MessageType.PERMISSION_MODE) {
    const pm = safeParsePayload(PermissionModePayloadSchema, payload, "PERMISSION_MODE");
    await ctx.setPermissionModeByRpc(pm.mode, "app");
    console.log(`[remote] 权限模式切换: ${ctx.getPermissionMode()}`);
    return true;
  }

  if (envelope.type === MessageType.MODEL_MODE) {
    const mm = safeParsePayload(ModelModePayloadSchema, payload, "MODEL_MODE");
    ctx.setModelMode(mm.mode);
    console.log(`[remote] 模型模式切换: ${ctx.getModelMode()}`);
    ctx.emitModelModeChanged(ctx.getModelMode());
    void ctx.runConfigChangeHook({
      event: "model_mode",
      mode: ctx.getModelMode(),
      sessionId: ctx.getSessionId(),
      cwd: process.cwd(),
    }).catch(() => {});
    void ctx.heartbeatTick();
    return true;
  }

  if (envelope.type === MessageType.RPC_REGISTER) {
    const reg = safeParsePayload(RpcRegisterPayloadSchema, payload, "RPC_REGISTER");
    rpcRegistry.register(reg.method, {
      write: reg.meta.write,
      handler: async () => ({ registered: true, method: reg.method }),
    });
    console.log(`[remote] RPC 注册: ${reg.method}`);
    return true;
  }

  if (envelope.type === MessageType.RPC_UNREGISTER) {
    const unreg = safeParsePayload(RpcUnregisterPayloadSchema, payload, "RPC_UNREGISTER");
    rpcRegistry.unregister(unreg.method);
    console.log(`[remote] RPC 注销: ${unreg.method}`);
    return true;
  }

  if (envelope.type === MessageType.FOREGROUND_PROBE) {
    const probe = safeParsePayload(ForegroundProbePayloadSchema, payload, "FOREGROUND_PROBE");
    const snapshot = ctx.getForegroundProbeSnapshot();
    await ctx.sendEnvelope(MessageType.FOREGROUND_PROBE_ACK, JSON.stringify({
      probeId: probe.probeId,
      clientTs: probe.clientTs,
      serverTs: Date.now(),
      ...snapshot,
    }));
    return true;
  }

  return false;
}

async function handleNewSession(payload: NewSessionPayload, ctx: ControlRouterContext): Promise<void> {
  if (payload.workDir) {
    try { process.chdir(payload.workDir); } catch {}
  }
  if (payload.agent && ["claude", "codex", "gemini"].includes(payload.agent)) {
    ctx.setDefaultAgent(payload.agent as AgentType);
  }
  console.log(`[remote] 新会话 (agent: ${ctx.getDefaultAgent()}, cwd: ${process.cwd()})`);
  ctx.refreshProjectScopedConfig();
  void ctx.runConfigChangeHook({
    event: "new_session",
    cwd: process.cwd(),
    sessionId: ctx.getSessionId(),
    agent: ctx.getDefaultAgent(),
  }).catch(() => {});
  void ctx.heartbeatTick();
}

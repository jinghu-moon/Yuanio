import { MessageType } from "@yuanio/shared";
import type { HeartbeatPayload, AgentStatus, PermissionMode, ModelMode } from "@yuanio/shared";
import type { AgentType } from "../spawn";
import type { AgentHandle } from "../spawn";
import { basename } from "node:path";

const IDLE_INTERVAL = 30_000;
const ACTIVE_INTERVAL = 5_000;

export interface HeartbeatController {
  tick: () => Promise<void>;
  stop: () => void;
}

export function startHeartbeat(params: {
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number) => Promise<void>;
  getStatus: () => AgentStatus;
  getDefaultAgent: () => AgentType;
  getPermissionMode: () => PermissionMode;
  getModelMode?: () => ModelMode;
  getMetadataVersion?: () => number;
  getTurnStateVersion?: () => number;
  getTurnStateReason?: () => string;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  startTime: number;
}): HeartbeatController {
  const { sendEnvelope, getStatus, getDefaultAgent, getPermissionMode, getModelMode, getMetadataVersion, getTurnStateVersion, getTurnStateReason, runningAgents, startTime } = params;
  let heartbeatTimer: Timer | null = null;
  let currentInterval = IDLE_INTERVAL;

  const tick = async () => {
    const isActive = runningAgents.size > 0;
    const agents = Array.from(runningAgents.entries()).map(([id, v]) => ({ taskId: id, agent: v.agent }));
    const hb: HeartbeatPayload = {
      status: isActive ? "running" : getStatus(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      projectPath: process.cwd(),
      projectName: basename(process.cwd()),
      agent: getDefaultAgent(),
      runningTasks: agents.length > 0 ? agents : undefined,
      permissionMode: getPermissionMode(),
      metadataVersion: getMetadataVersion?.(),
      modelMode: getModelMode?.(),
      turnStateVersion: getTurnStateVersion?.(),
      turnStateReason: getTurnStateReason?.(),
    };
    await sendEnvelope(MessageType.HEARTBEAT, JSON.stringify(hb));

    // 自适应间隔：agent 运行时 5s，空闲时 30s
    const desired = isActive ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (desired !== currentInterval) {
      currentInterval = desired;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => { void tick(); }, currentInterval);
    }
  };

  void tick();
  heartbeatTimer = setInterval(() => { void tick(); }, currentInterval);

  return {
    tick,
    stop: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    },
  };
}

import type { AgentStatus, ModelMode, PermissionMode } from "@yuanio/shared";

export interface ForegroundProbeSnapshot {
  [key: string]: unknown;
  sessionId: string;
  status: AgentStatus;
  cwd: string;
  executionMode: "act" | "plan";
  turnStateVersion: number;
  turnStateReason: string;
  runningTasks: number;
  pendingApprovals: number;
  permissionMode: PermissionMode;
  modelMode: ModelMode;
  lastOutboundSeq: number;
}

export interface CreateForegroundProbeSnapshotOptions {
  getSessionId: () => string;
  getStatus: () => AgentStatus;
  getCwd: () => string;
  getExecutionMode: () => "act" | "plan";
  getTurnStateVersion: () => number;
  getTurnStateReason: () => string;
  getRunningTasks: () => number;
  getPendingApprovals: () => number;
  getPermissionMode: () => PermissionMode;
  getModelMode: () => ModelMode;
  getLastOutboundSeq: () => number;
}

export function createForegroundProbeSnapshotProvider(options: CreateForegroundProbeSnapshotOptions) {
  return (): ForegroundProbeSnapshot => ({
    sessionId: options.getSessionId(),
    status: options.getStatus(),
    cwd: options.getCwd(),
    executionMode: options.getExecutionMode(),
    turnStateVersion: options.getTurnStateVersion(),
    turnStateReason: options.getTurnStateReason(),
    runningTasks: options.getRunningTasks(),
    pendingApprovals: options.getPendingApprovals(),
    permissionMode: options.getPermissionMode(),
    modelMode: options.getModelMode(),
    lastOutboundSeq: options.getLastOutboundSeq(),
  });
}

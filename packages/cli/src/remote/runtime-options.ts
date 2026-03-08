import { resolveApprovalLevel, type ApprovalLevel } from "./approval-utils";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value || "");
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  const n = Number(value || "");
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export interface RemoteRuntimeOptions {
  approvalLevel: ApprovalLevel;
  maxProcessedInboundEnvelopeIds: number;
  maxParallel?: number;
  contextRefsEnabled: boolean;
  autoTestGateEnabled: boolean;
  autoTestGateCmd: string;
  autoTestGateTimeoutMs: number;
  checkpointMaxItems?: number;
  terminalSnapshotMaxLines: number;
  taskRegistryMaxHistory?: number;
  taskRegistryMaxOutputLines?: number;
  contextWindowSize: number;
}

export function resolveRemoteRuntimeOptions(env: NodeJS.ProcessEnv = process.env): RemoteRuntimeOptions {
  return {
    approvalLevel: resolveApprovalLevel(env.YUANIO_APPROVAL_LEVEL),
    maxProcessedInboundEnvelopeIds: parsePositiveInt(env.YUANIO_MAX_PROCESSED_ENVELOPE_IDS, 2000),
    maxParallel: parseOptionalPositiveInt(env.YUANIO_MAX_PARALLEL),
    contextRefsEnabled: env.YUANIO_CONTEXT_REFS_ENABLED !== "0",
    autoTestGateEnabled: env.YUANIO_AUTOTEST_GATE_ENABLED === "1",
    autoTestGateCmd: (env.YUANIO_AUTOTEST_GATE_CMD || "").trim(),
    autoTestGateTimeoutMs: parsePositiveInt(env.YUANIO_AUTOTEST_GATE_TIMEOUT_MS, 180_000),
    checkpointMaxItems: parseOptionalPositiveInt(env.YUANIO_CHECKPOINT_MAX_ITEMS),
    terminalSnapshotMaxLines: parsePositiveInt(env.YUANIO_TERMINAL_SNAPSHOT_MAX_LINES, 160),
    taskRegistryMaxHistory: parseOptionalPositiveInt(env.YUANIO_TASK_REGISTRY_MAX_HISTORY),
    taskRegistryMaxOutputLines: parseOptionalPositiveInt(env.YUANIO_TASK_REGISTRY_MAX_OUTPUT_LINES),
    contextWindowSize: parsePositiveInt(env.YUANIO_CONTEXT_WINDOW_SIZE, 200_000),
  };
}

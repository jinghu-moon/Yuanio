import { z } from "zod";
import { MessageType } from "./types";

// Envelope payload 上限（与 relay maxHttpBufferSize 协同）
export const MAX_ENVELOPE_STRING_PAYLOAD_CHARS = 1_048_576; // 1 MiB 文本
export const MAX_ENVELOPE_BINARY_PAYLOAD_BYTES = 1_048_576; // 1 MiB 二进制

// ── 辅助函数 ──

/** JSON.parse + Zod parse，校验失败直接抛异常 */
export function safeParsePayload<T>(
  schema: z.ZodType<T>,
  raw: string,
  label?: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[schema] ${label ?? "unknown"} JSON.parse 失败: ${(e as Error).message}`);
  }
  return schema.parse(parsed);
}

// ── Envelope schema ──

function getBinaryPayloadLength(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  const bufferRef = (globalThis as { Buffer?: { isBuffer: (v: unknown) => boolean } }).Buffer;
  if (bufferRef?.isBuffer?.(value)) {
    return (value as { length: number }).length;
  }
  return -1;
}

const BinaryPayloadSchema = z.custom<Uint8Array | ArrayBuffer>((value) => {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true;
  const bufferRef = (globalThis as { Buffer?: { isBuffer: (v: unknown) => boolean } }).Buffer;
  if (bufferRef?.isBuffer?.(value)) return true;
  return false;
}, { message: "invalid binary payload" }).refine((value) => {
  const bytes = getBinaryPayloadLength(value);
  return bytes >= 0 && bytes <= MAX_ENVELOPE_BINARY_PAYLOAD_BYTES;
}, {
  message: `binary payload too large (max ${MAX_ENVELOPE_BINARY_PAYLOAD_BYTES} bytes)`,
});

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  source: z.string().min(1),
  target: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.nativeEnum(MessageType),
  ptyId: z.string().optional(),
  ts: z.number().int().nonnegative(),
  relayTs: z.number().int().nonnegative().optional(),
  payload: z.union([z.string().max(MAX_ENVELOPE_STRING_PAYLOAD_CHARS), BinaryPayloadSchema]),
});

export const AckMessageSchema = z.object({
  messageId: z.string().min(1),
  source: z.string().min(1),
  sessionId: z.string().min(1),
  state: z.enum(["ok", "working", "retry_after", "terminal"]).optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
  reason: z.string().max(240).optional(),
  at: z.number().int().nonnegative().optional(),
});

// ── 基础类型 schema ──

export const AgentStatusSchema = z.enum(["idle", "running", "waiting_approval", "error"]);

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const UsageInfoSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
});

// ── Phase 3: 权限模式 ──

export const PermissionModeSchema = z.enum(["default", "acceptEdits", "yolo", "readonly"]);

// ── Payload schema ──

export const HeartbeatPayloadSchema = z.object({
  status: AgentStatusSchema,
  uptime: z.number(),
  projectPath: z.string().optional(),
  projectName: z.string().optional(),
  agent: z.string().optional(),
  runningTasks: z.array(z.object({ taskId: z.string(), agent: z.string() })).optional(),
  permissionMode: PermissionModeSchema,
  metadataVersion: z.number().optional(),
  modelMode: z.enum(["default", "sonnet", "opus"]).optional(),
  turnStateVersion: z.number().optional(),
  turnStateReason: z.string().optional(),
});

export const ForegroundProbePayloadSchema = z.object({
  probeId: z.string().optional(),
  clientTs: z.number().optional(),
});

export const ForegroundProbeAckPayloadSchema = z.object({
  probeId: z.string().optional(),
  clientTs: z.number().optional(),
  serverTs: z.number(),
  sessionId: z.string(),
  status: AgentStatusSchema,
  cwd: z.string(),
  turnStateVersion: z.number(),
  turnStateReason: z.string(),
  runningTasks: z.number(),
  pendingApprovals: z.number(),
  permissionMode: PermissionModeSchema,
  modelMode: z.enum(["default", "sonnet", "opus"]).optional(),
  lastOutboundSeq: z.number().optional(),
});

export const TurnStatePayloadSchema = z.object({
  phase: AgentStatusSchema,
  sessionId: z.string(),
  version: z.number(),
  reason: z.string(),
  updatedAt: z.number(),
  runningTasks: z.number(),
  pendingApprovals: z.number(),
});

export const InteractionActionTypeSchema = z.enum([
  "continue",
  "stop",
  "approve",
  "reject",
  "retry",
  "rollback",
]);

export const InteractionActionSourceSchema = z.enum([
  "app",
  "telegram",
  "notification",
  "system",
]);

export const InteractionStatePayloadSchema = z.object({
  state: AgentStatusSchema,
  sessionId: z.string(),
  version: z.number(),
  reason: z.string(),
  updatedAt: z.number(),
  runningTasks: z.number(),
  pendingApprovals: z.number(),
  availableActions: z.array(InteractionActionTypeSchema),
  activeApprovalId: z.string().optional(),
  riskLevel: RiskLevelSchema.optional(),
  riskSummary: z.string().optional(),
  diffHighlights: z.array(z.string()).optional(),
  lastError: z.string().optional(),
});

export const InteractionActionPayloadSchema = z.object({
  action: InteractionActionTypeSchema,
  source: InteractionActionSourceSchema.optional(),
  approvalId: z.string().optional(),
  taskId: z.string().optional(),
  path: z.string().optional(),
  prompt: z.string().optional(),
  reason: z.string().optional(),
});

export const ReplayDonePayloadSchema = z.object({
  sessionId: z.string(),
  replayed: z.number(),
  daemonCached: z.number(),
  rounds: z.number(),
  reason: z.enum(["startup", "connect", "seq_gap", "manual"]),
  at: z.number(),
});

export const NewSessionPayloadSchema = z.object({
  workDir: z.string().optional(),
  agent: z.string().optional(),
});

export const RpcReqPayloadSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.unknown()),
});

export const RpcRespPayloadSchema = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const ApprovalReqPayloadSchema = z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string(),
  affectedFiles: z.array(z.string()),
  riskLevel: RiskLevelSchema.optional(),
  riskSummary: z.string().optional(),
  diffHighlights: z.array(z.string()).optional(),
  preview: z.string().optional(),
  context: z.string().optional(),
  permissionMode: PermissionModeSchema,
});

export const ApprovalRespPayloadSchema = z.object({
  id: z.string(),
  approved: z.boolean(),
});

export const SessionSwitchPayloadSchema = z.object({
  sessionId: z.string(),
  tokens: z.record(z.string()),
  reason: z.string().optional(),
});

export const PtySpawnPayloadSchema = z.object({
  shell: z.string().optional(),
  cols: z.number(),
  rows: z.number(),
  cwd: z.string().optional(),
});

export const PtyResizePayloadSchema = z.object({
  cols: z.number(),
  rows: z.number(),
});

export const PtyAckPayloadSchema = z.object({
  bytes: z.number(),
});

export const TaskQueuePayloadSchema = z.object({
  action: z.enum(["enqueue", "status", "clear"]),
  prompt: z.string().optional(),
  agent: z.string().optional(),
  priority: z.number().optional(),
});

export const DiffActionPayloadSchema = z.object({
  action: z.enum(["accept", "rollback"]),
  path: z.string(),
});

// ── Phase 3: 权限模式 Payload ──

export const PermissionModePayloadSchema = z.object({
  mode: PermissionModeSchema,
});

// ── Phase 4: 会话生命周期 ──

export const SessionSpawnPayloadSchema = z.object({
  directory: z.string(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  resumeSessionId: z.string().optional(),
});

export const SessionStopPayloadSchema = z.object({
  sessionId: z.string(),
});

export const SessionInfoPayloadSchema = z.object({
  sessionId: z.string(),
  pid: z.number(),
  agent: z.string(),
  directory: z.string(),
  startedAt: z.number(),
  status: z.enum(["running", "stopped"]),
});

export const SessionListPayloadSchema = z.object({
  sessions: z.array(SessionInfoPayloadSchema),
});

export const SessionStatusPayloadSchema = z.object({
  action: z.enum(["spawn", "stop", "list"]),
  ok: z.boolean(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  session: SessionInfoPayloadSchema.optional(),
  sessions: z.array(SessionInfoPayloadSchema).optional(),
});

// ── Phase 8: Todo ──

export const TodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  priority: z.enum(["high", "medium", "low"]),
});

export const TodoUpdatePayloadSchema = z.object({
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  todos: z.array(TodoItemSchema),
});

// ── Phase 9: 模型模式 ──

export const ModelModeSchema = z.enum(["default", "sonnet", "opus"]);

export const ModelModePayloadSchema = z.object({
  mode: ModelModeSchema,
});

// ── Phase 11: RPC 动态注册 ──

export const RpcRegisterPayloadSchema = z.object({
  method: z.string(),
  meta: z.object({
    write: z.boolean(),
  }).passthrough(),
});

export const RpcUnregisterPayloadSchema = z.object({
  method: z.string(),
});

// 消息类型枚举
export enum MessageType {
  PROMPT = "prompt",
  STREAM_CHUNK = "stream_chunk",
  STREAM_END = "stream_end",
  DEVICE_ONLINE = "device:online",
  DEVICE_OFFLINE = "device:offline",
  ACK = "ack",
  TOOL_CALL = "tool_call",
  FILE_DIFF = "file_diff",
  APPROVAL_REQ = "approval_req",
  APPROVAL_RESP = "approval_resp",
  STATUS = "status",
  HEARTBEAT = "heartbeat",
  FOREGROUND_PROBE = "foreground_probe",
  FOREGROUND_PROBE_ACK = "foreground_probe_ack",
  TURN_STATE = "turn_state",
  INTERACTION_STATE = "interaction_state",
  INTERACTION_ACTION = "interaction_action",
  REPLAY_DONE = "replay_done",
  NEW_SESSION = "new_session",
  RPC_REQ = "rpc_req",
  RPC_RESP = "rpc_resp",
  TERMINAL_OUTPUT = "terminal_output",
  HOOK_EVENT = "hook_event",
  DEVICE_LIST = "device_list",
  CANCEL = "cancel",
  SESSION_SWITCH = "session_switch",
  SESSION_SWITCH_ACK = "session_switch_ack",
  // PTY 终端
  PTY_SPAWN = "pty_spawn",
  PTY_INPUT = "pty_input",
  PTY_OUTPUT = "pty_output",
  PTY_RESIZE = "pty_resize",
  PTY_EXIT = "pty_exit",
  PTY_KILL = "pty_kill",
  PTY_ACK = "pty_ack",
  PTY_STATUS = "pty_status",
  // 任务队列
  TASK_QUEUE = "task_queue",
  TASK_QUEUE_STATUS = "task_queue_status",
  // 任务摘要
  TASK_SUMMARY = "task_summary",
  // Token 用量
  USAGE_REPORT = "usage_report",
  // Diff 操作
  DIFF_ACTION = "diff_action",
  DIFF_ACTION_RESULT = "diff_action_result",
  // 定时任务
  SCHEDULE_CREATE = "schedule_create",
  SCHEDULE_LIST = "schedule_list",
  SCHEDULE_DELETE = "schedule_delete",
  SCHEDULE_TRIGGER = "schedule_trigger",
  SCHEDULE_STATUS = "schedule_status",
  // 权限模式 (Phase 3)
  PERMISSION_MODE = "permission_mode",
  // Phase 8: Todo
  TODO_UPDATE = "todo_update",
  // Phase 9: 模型模式
  MODEL_MODE = "model_mode",
  // Phase 12: 对话式 Agent UI
  THINKING = "thinking",
  // Phase 11: RPC 动态注册
  RPC_REGISTER = "rpc_register",
  RPC_UNREGISTER = "rpc_unregister",
  // 会话生命周期 (Phase 4)
  SESSION_SPAWN = "session_spawn",
  SESSION_STOP = "session_stop",
  SESSION_LIST = "session_list",
  SESSION_STATUS = "session_status",
}

export interface HeartbeatPayload {
  status: AgentStatus;
  uptime: number;
  projectPath?: string;
  projectName?: string;
  agent?: string;
  runningTasks?: { taskId: string; agent: string }[];
  permissionMode: PermissionMode;
  metadataVersion?: number;
  modelMode?: ModelMode;
  turnStateVersion?: number;
  turnStateReason?: string;
}

export interface ForegroundProbePayload {
  probeId?: string;
  clientTs?: number;
}

export interface ForegroundProbeAckPayload {
  probeId?: string;
  clientTs?: number;
  serverTs: number;
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
}

export interface TurnStatePayload {
  phase: AgentStatus;
  sessionId: string;
  version: number;
  reason: string;
  updatedAt: number;
  runningTasks: number;
  pendingApprovals: number;
}

export type InteractionActionType =
  | "continue"
  | "stop"
  | "approve"
  | "reject"
  | "retry"
  | "rollback";

export type InteractionActionSource =
  | "app"
  | "telegram"
  | "notification"
  | "system";

export interface InteractionStatePayload {
  state: AgentStatus;
  sessionId: string;
  version: number;
  reason: string;
  updatedAt: number;
  runningTasks: number;
  pendingApprovals: number;
  availableActions: InteractionActionType[];
  activeApprovalId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  riskSummary?: string;
  diffHighlights?: string[];
  lastError?: string;
}

export interface InteractionActionPayload {
  action: InteractionActionType;
  source?: InteractionActionSource;
  approvalId?: string;
  taskId?: string;
  path?: string;
  prompt?: string;
  reason?: string;
}

export interface ReplayDonePayload {
  sessionId: string;
  replayed: number;
  daemonCached: number;
  rounds: number;
  reason: "startup" | "connect" | "seq_gap" | "manual";
  at: number;
}

export interface NewSessionPayload {
  workDir?: string;
  agent?: string; // claude | codex | gemini
}

export interface RpcReqPayload {
  id: string;
  method: string; // ls | grep | git_status
  params: Record<string, unknown>;
}

export interface RpcRespPayload {
  id: string;
  result?: unknown;
  error?: string;
}

export interface SessionSwitchPayload {
  sessionId: string;
  tokens: Record<string, string>;
  reason?: string;
}

export interface SessionSwitchAckPayload {
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
}

// 需要 ACK 确认的消息类型
export const ACK_REQUIRED_TYPES: MessageType[] = [
  MessageType.PROMPT,
  MessageType.APPROVAL_RESP,
  MessageType.SESSION_SWITCH_ACK,
  MessageType.DIFF_ACTION_RESULT,
];

// ACK 消息（不加密，relay 可见）
export type AckState = "ok" | "working" | "retry_after" | "terminal";

export interface AckMessage {
  messageId: string;   // 被确认的消息 id
  source: string;      // 发送 ACK 的 device_id
  sessionId: string;
  state?: AckState;    // ACK 语义状态，默认 ok
  retryAfterMs?: number;
  reason?: string;
  at?: number;         // 发送 ACK 时间戳
}

// --- Phase 3 载荷类型（加密后放入 payload）---

export interface ToolCallPayload {
  tool: string;          // 工具名称
  params: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  agent?: string;        // 产出此工具调用的 Agent
  /** Claude/Gemini/Codex 工具调用 ID，用于 running → done 状态关联 */
  toolUseId?: string;
}

export interface ThinkingPayload {
  /** 当前 thinking 全文（partial message 下每次发送完整文本） */
  thinking: string;
  /** assistant 消息 ID，用于 Android 端按 turnId 合并 */
  turnId?: string;
  agent?: string;
  /** 首包前临时提示（消费端可选择不落历史） */
  ephemeral?: boolean;
  /** 临时提示结束信号 */
  done?: boolean;
  /** thinking 阶段标识 */
  phase?: string;
  /** 发送时已耗时（毫秒） */
  elapsedMs?: number;
}

export interface FileDiffPayload {
  path: string;
  diff: string;          // unified diff
  action: "created" | "modified" | "deleted";
}

export interface ApprovalReqPayload {
  id: string;             // 审批请求唯一标识
  description: string;
  tool: string;
  affectedFiles: string[];
  riskLevel?: "low" | "medium" | "high" | "critical";
  riskSummary?: string;   // 风险一句话摘要（3 秒可读）
  diffHighlights?: string[]; // 关键变更片段（高亮展示）
  preview?: string;       // 受影响文件前 2000 字符预览
  context?: string;       // 操作上下文描述
  permissionMode: PermissionMode;
}

export interface ApprovalRespPayload {
  id: string;             // 对应 ApprovalReqPayload.id
  approved: boolean;
}

export interface HookEventPayload {
  hook: string;        // hook 名称: PreToolUse / PostToolUse / Notification 等
  event: string;       // 事件描述
  tool?: string;       // 关联工具名
  data?: Record<string, unknown>;
  agent?: string;      // 产出此事件的 Agent
}

// --- PTY 终端载荷 ---

export interface PtySpawnPayload {
  shell?: string;
  cols: number;
  rows: number;
  cwd?: string;
}

export interface PtyResizePayload {
  cols: number;
  rows: number;
}

export interface PtyExitPayload {
  code: number;
}

export interface PtyAckPayload {
  bytes: number;
}

export interface PtyStatusPayload {
  pid?: number;
  startedAt: number;
  lastActiveAt: number;
  cols: number;
  rows: number;
  bufferedBytes: number;
  paused: boolean;
}

// --- 任务队列 (Feature 1) ---

export interface TaskQueuePayload {
  action: "enqueue" | "status" | "clear";
  prompt?: string;
  agent?: string;
  priority?: number;
}

export interface TaskQueueStatusPayload {
  queued: { id: string; prompt: string; agent?: string; priority: number; createdAt: number }[];
  running: string[];
  mode: "sequential" | "parallel";
}

// --- 任务摘要 (Feature 2) ---

export interface TaskSummaryPayload {
  taskId: string;
  duration: number;        // 毫秒
  gitDiff?: {
    stat: string;          // git diff --stat 输出
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  usage?: UsageInfo;
}

// --- Token 用量 (Feature 4) ---

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface UsageReportPayload {
  taskId: string;
  usage: UsageInfo;
  cumulative: boolean;     // true = 累计值, false = 增量
}

// --- Diff 操作 (Feature 5) ---

export interface DiffActionPayload {
  action: "accept" | "rollback";
  path: string;
}

export interface DiffActionResultPayload {
  path: string;
  action: "accept" | "rollback";
  success: boolean;
  error?: string;
}

// --- 定时任务 (Feature 9) ---

export interface ScheduleCreatePayload {
  id?: string;
  cron: string;            // 5 字段 cron 表达式
  prompt: string;
  agent?: string;
  enabled?: boolean;
}

export interface ScheduleItemPayload {
  id: string;
  cron: string;
  prompt: string;
  agent?: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

export interface ScheduleDeletePayload {
  id: string;
}

export interface ScheduleStatusPayload {
  schedules: ScheduleItemPayload[];
}

export type AgentStatus = "idle" | "running" | "waiting_approval" | "error";

export interface StatusPayload {
  status: AgentStatus;
  projectPath?: string;
  sessionId?: string;
  version?: number;
  reason?: string;
  updatedAt?: number;
  runningTasks?: number;
  pendingApprovals?: number;
}

// 设备角色
export type DeviceRole = "agent" | "app";

// 设备信息
export interface DeviceInfo {
  id: string;
  publicKey: string;
  role: DeviceRole;
  sessionId: string;
}

// 加密信封 — relay 只看顶层路由字段，不碰 payload
export interface Envelope {
  id: string;            // UUID v7 — 去重 + 时间排序
  seq: number;           // 发送端递增序列号 — 保证顺序 + 检测丢失
  source: string;        // 发送方 device_id
  target: string;        // 接收方 device_id | "broadcast"
  sessionId: string;
  type: MessageType;
  ptyId?: string;        // PTY 会话标识（多终端）
  ts: number;            // Unix 毫秒时间戳
  relayTs?: number;      // relay 接收时间戳（调试用）
  payload: string;       // Base64(nonce + ciphertext)
}

// Binary 信封 — PTY 等高频消息使用，payload 为原始字节，省去 Base64 膨胀 33%
export interface BinaryEnvelope {
  id: string;
  seq: number;
  source: string;
  target: string;
  sessionId: string;
  type: MessageType;
  ptyId?: string;        // PTY 会话标识（多终端）
  ts: number;
  payload: Uint8Array;   // 原始 nonce + ciphertext（Socket.IO 自动处理二进制）
}

// 配对请求
export interface PairingRequest {
  code: string;
  sessionId: string;
  agentPublicKey: string;
  agentDeviceId: string;
  sessionToken: string;
  expiresAt: string;
  joined: boolean;
}

// 配对结果
export interface PairCreateResult {
  pairingCode: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
}

export interface PairJoinResult {
  agentPublicKey: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
}

// --- Phase 3: 权限模式 ---

export type PermissionMode = "default" | "acceptEdits" | "yolo" | "readonly";

export interface PermissionModePayload {
  mode: PermissionMode;
}

// --- Phase 4: 会话生命周期管理 ---

export interface SessionSpawnPayload {
  directory: string;
  agent?: "claude" | "codex" | "gemini";
  resumeSessionId?: string;
}

export interface SessionStopPayload {
  sessionId: string;
}

export interface SessionInfoPayload {
  sessionId: string;
  pid: number;
  agent: string;
  directory: string;
  startedAt: number;
  status: "running" | "stopped";
}

export interface SessionListPayload {
  sessions: SessionInfoPayload[];
}

export interface SessionStatusPayload {
  action: "spawn" | "stop" | "list";
  ok: boolean;
  message?: string;
  sessionId?: string;
  session?: SessionInfoPayload;
  sessions?: SessionInfoPayload[];
}

// --- Phase 6: 消息持久化 + 分页 ---

// --- Phase 7: 会话缓存 + 版本控制 ---

export interface SessionMeta {
  metadataVersion: number;
  agentStateVersion: number;
  activeAt: number;
  thinking: boolean;
  thinkingAt: number;
  modelMode?: ModelMode;
}

// --- Phase 6 续 ---

export interface StoredMessagePayload {
  id: string;
  seq: number;
  content: unknown;
  role: string;
  createdAt: number;
}

export interface MessagePagePayload {
  messages: StoredMessagePayload[];
  page: {
    limit: number;
    beforeSeq: number | null;
    nextBeforeSeq: number | null;
    hasMore: boolean;
  };
}

// --- Phase 8: Todo ---

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface TodoUpdatePayload {
  sessionId?: string;
  taskId?: string;
  todos: TodoItem[];
}

// --- Phase 9: 模型模式 ---

export type ModelMode = "default" | "sonnet" | "opus";

export interface ModelModePayload {
  mode: ModelMode;
}

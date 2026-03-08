import type { AgentType, AgentHandle } from "./spawn";
import { deleteTelegramWebhook, sendTelegram, sendTelegramMessage } from "./telegram";
import { MessageType, SeqCounter, resolveIngressNetworkMode } from "@yuanio/shared";
import type { Envelope, BinaryEnvelope, AgentStatus, UsageInfo, PermissionMode, ModelMode } from "@yuanio/shared";
import type { RelayClient } from "./relay-client";
import { resolveApproval, getApprovalPort } from "./approval-server";
import { resetAdapters } from "./adapters";
import type { LocalServer } from "./local-server";
import { createEnvelopeSender } from "./remote/sender";
import { createPtyController } from "./remote/pty";
import type { PendingDrainReason } from "./remote/pending";
import { createInboundEnvelopeTracker } from "./remote/inbound-tracker";
import { registerRemoteProcessCleanup } from "./remote/process-cleanup";
import { createEnvelopeRuntimeSetup } from "./remote/envelope-runtime-setup";
import { createRouterContextSetup } from "./remote/router-context-setup";
import { createPromptRuntimeSetup } from "./remote/prompt-runtime-setup";
import { sendQueueStatus } from "./remote/queue";
import { startLocalLan, registerLocalCleanup } from "./remote/local-lan";
import { createRpcRuntimeSetup } from "./remote/rpc-runtime-setup";
import { createTelegramWiringSetup } from "./remote/telegram-wiring-setup";
import { clearQueue, loadQueueFromDisk, queueSize } from "./task-queue";
import { eventBus } from "./event-bus";
import { getRecentResumeSessions } from "./remote/resume-sessions";
import { applyPromptContextRefs, createTerminalSnapshotStore } from "./remote/context-refs";
import { createCheckpointStore, rollbackFiles } from "./remote/checkpoints";
import { createCheckpointService } from "./remote/checkpoint-service";
import { createTaskRegistry } from "./remote/task-registry";
import { createHookLifecycle } from "./remote/hook-lifecycle";
import { createCoreRuntimeSetup } from "./remote/core-runtime-setup";
import { createApprovalRuntime } from "./remote/approval-runtime";
import type { ExecutionMode } from "./remote/mode-controller";
import { createPromptSourceResolver } from "./remote/prompt-source-resolver";
import { formatRunningTasksPanel } from "./remote/running-tasks-panel";
import { executeInteractionAction } from "./remote/interaction-action-executor";
import { createTurnStateEmitter } from "./remote/turn-state-emitter";
import { createForegroundProbeSnapshotProvider } from "./remote/foreground-probe";
import { createWebhookSessionCleanup } from "./remote/webhook-session-cleanup";
import { resolveRemoteRuntimeOptions } from "./remote/runtime-options";
import { startRuntimeStartup } from "./remote/runtime-startup";
import {
  createProjectScopeConfigProvider,
} from "./remote/rpc-runtime-providers";
import { TELEGRAM_COMMAND_CATALOG } from "./remote/telegram-command-catalog";
import {
  getPermissionRules,
  getSandboxPolicy,
  type PermissionRuleSet,
  type SandboxPolicy,
} from "./remote/permission-policy";
import {
  buildAutoMemoryContext,
} from "./remote/memory-center";
import {
  getCurrentOutputStyle,
  applyOutputStyleToPrompt,
} from "./remote/output-style";

function resolveDefaultAgentFromEnv(): AgentType {
  const raw = process.env.YUANIO_DEFAULT_AGENT;
  if (raw === "claude" || raw === "codex" || raw === "gemini") return raw;
  return "codex";
}

const startTime = Date.now();
let currentStatus: AgentStatus = "idle";
let defaultAgent: AgentType = resolveDefaultAgentFromEnv();
let currentPermissionMode: PermissionMode = "default";
let currentModelMode: ModelMode = "default";
let currentExecutionMode: ExecutionMode = process.env.YUANIO_EXECUTION_MODE === "plan" ? "plan" : "act";

// 多 Agent 并行实例追踪
const runningAgents = new Map<string, { handle: AgentHandle; agent: AgentType }>();
let taskSeq = 0;
function nextTaskId() { return `task_${++taskSeq}`; }

// Token 用量追踪 (Feature 4)
const taskUsageMap = new Map<string, UsageInfo>();
const taskStartMap = new Map<string, number>();

export function getAgentStatus(): AgentStatus { return currentStatus; }
export function setAgentStatus(s: AgentStatus) { currentStatus = s; }

export async function setupRemoteMode(
  relay: RelayClient,
  sharedKey: CryptoKey,
  deviceId: string,
  sessionId: string,
  peerDeviceId: string,
  serverUrl: string,
  sessionToken: string,
) {
  console.log("\n┌─────────────────────────────────────────┐");
  console.log("│  远程控制中 — 终端只读                │");
  console.log("│  手机端可发送 prompt，双空格切换本地模式 │");
  console.log("└─────────────────────────────────────────┘\n");

  const restored = loadQueueFromDisk();

  const seq = new SeqCounter();
  const processedPromptIds = new Map<string, number>();
  const maxProcessedPrompts = 200;
  let drainPendingRef: ((reason?: PendingDrainReason) => Promise<void>) | null = null;
  const runtimeOptions = resolveRemoteRuntimeOptions(process.env);
  const maxProcessedInboundEnvelopeIds = runtimeOptions.maxProcessedInboundEnvelopeIds;
  const inboundTracker = createInboundEnvelopeTracker({
    maxProcessedInboundEnvelopeIds,
    onSeqGapDrain: () => {
      if (!relay.connected) return;
      if (!drainPendingRef) return;
      void drainPendingRef("seq_gap");
    },
  });
  let activeSessionId = sessionId;
  let activeSessionToken = sessionToken;
  let activeSharedKey = sharedKey;
  const approvalLevel = runtimeOptions.approvalLevel;
  const maxParallel = runtimeOptions.maxParallel;
  const contextRefsEnabled = runtimeOptions.contextRefsEnabled;
  const autoTestGateEnabled = runtimeOptions.autoTestGateEnabled;
  const autoTestGateCmd = runtimeOptions.autoTestGateCmd;
  const autoTestGateTimeoutMs = runtimeOptions.autoTestGateTimeoutMs;
  const checkpointStore = createCheckpointStore({
    maxItems: runtimeOptions.checkpointMaxItems,
  });
  const terminalSnapshotStore = createTerminalSnapshotStore(
    runtimeOptions.terminalSnapshotMaxLines,
  );
  const taskRegistry = createTaskRegistry({
    maxHistory: runtimeOptions.taskRegistryMaxHistory,
    maxOutputLines: runtimeOptions.taskRegistryMaxOutputLines,
  });
  const hookLifecycle = createHookLifecycle(process.cwd());
  let permissionRules: PermissionRuleSet = getPermissionRules(process.cwd());
  let sandboxPolicy: SandboxPolicy = getSandboxPolicy(process.cwd());
  const contextWindowSize = runtimeOptions.contextWindowSize;
  const cumulativeUsage: Required<UsageInfo> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const compactSummaries: Array<{ id: string; at: number; instructions?: string }> = [];
  let handleEnvelope: (envelope: Envelope | BinaryEnvelope) => Promise<void> = async () => {
    throw new Error("remote envelope handler not initialized");
  };

  // ── 启动局域网直连服务器 + mDNS ──
  let localServer: LocalServer | null = null;
  localServer = startLocalLan({
    sessionId: activeSessionId,
    sharedKey: activeSharedKey,
    deviceId,
    onEnvelope: (env) => {
      handleEnvelope(env).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[local] 处理消息失败:", msg);
      });
    },
    onClientChange: (count) => {
      console.log(`[local] 直连客户端: ${count}`);
    },
  });

  const { sendEnvelope, sendBinaryEnvelope } = createEnvelopeSender({
    relay,
    getLocalServer: () => localServer,
    deviceId,
    peerDeviceId,
    seq,
    getSessionId: () => activeSessionId,
    getSharedKey: () => activeSharedKey,
  });

  const ptyController = createPtyController(sendEnvelope, sendBinaryEnvelope);

  if (restored > 0) {
    console.log(`[queue] 已恢复 ${restored} 条任务`);
    void sendQueueStatus(sendEnvelope, runningAgents);
  }

  const updateSession = (newSessionId: string, newToken: string, newKey: CryptoKey) => {
    activeSessionId = newSessionId;
    activeSessionToken = newToken;
    activeSharedKey = newKey;
    inboundTracker.clearSourceHighWatermark();
  };
  const pendingApprovals = new Map<string, {
    tool: string;
    riskLevel: string;
    createdAt: number;
    telegramMessageId?: number;
  }>();
  const turnStateEmitter = createTurnStateEmitter({
    getCurrentStatus: () => currentStatus,
    setCurrentStatus: (status) => {
      currentStatus = status;
    },
    getSessionId: () => activeSessionId,
    getProjectPath: () => process.cwd(),
    getRunningTasks: () => runningAgents.size,
    getPendingApprovals: () => pendingApprovals.size,
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    emitStatusChanged: (status) => {
      eventBus.emit({ type: "status-changed", status });
    },
    initialReason: "startup",
  });
  const emitStatusAndTurnState = (
    nextStatus: AgentStatus,
    reason?: string,
    force = false,
  ) => turnStateEmitter.emitStatusAndTurnState(nextStatus, reason, force);
  const getTurnStateVersion = () => turnStateEmitter.getTurnStateVersion();
  const getTurnStateReason = () => turnStateEmitter.getTurnStateReason();
  const checkpointService = createCheckpointService({
    checkpointStore,
    rollbackFiles,
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    emitStatusAndTurnState: (nextStatus, reason, force) => emitStatusAndTurnState(nextStatus, reason, force),
  });
  const listCheckpointText = (): string => checkpointService.listCheckpointText();
  const resolveCheckpointTarget = (target: string) => checkpointService.resolveCheckpointTarget(target);
  const rewindToTarget = (target: string, dryRun = false) => checkpointService.rewindToTarget(target, dryRun);
  const restoreCheckpointById = (checkpointId: string): Promise<string> => checkpointService.restoreCheckpointById(checkpointId);

  const getForegroundProbeSnapshot = createForegroundProbeSnapshotProvider({
    getSessionId: () => activeSessionId,
    getStatus: () => currentStatus,
    getCwd: () => process.cwd(),
    getExecutionMode: () => currentExecutionMode,
    getTurnStateVersion: () => getTurnStateVersion(),
    getTurnStateReason: () => getTurnStateReason(),
    getRunningTasks: () => runningAgents.size,
    getPendingApprovals: () => pendingApprovals.size,
    getPermissionMode: () => currentPermissionMode,
    getModelMode: () => currentModelMode,
    getLastOutboundSeq: () => seq.current(),
  });

  const refreshProjectScopedConfig = createProjectScopeConfigProvider(
    () => process.cwd(),
    (next) => {
      permissionRules = next;
    },
    (next) => {
      sandboxPolicy = next;
    },
    () => {
      hookLifecycle.reload();
    },
  );

  const {
    getContextUsage,
    renderStatusline,
    loopMaxIterations,
    validateForwardCommand,
    buildLoopPrompt,
    setExecutionMode,
    setPermissionModeByRpc,
    preprocessPromptForExecution,
  } = createCoreRuntimeSetup({
    env: process.env,
    statusline: {
      getCwd: () => process.cwd(),
      getSessionId: () => activeSessionId,
      getStatus: () => currentStatus,
      getExecutionMode: () => currentExecutionMode,
      getRunningTasks: () => runningAgents.size,
      getPendingApprovals: () => pendingApprovals.size,
      getQueueSize: () => queueSize(),
      getUptimeMs: () => Date.now() - startTime,
      getUsageTotals: () => ({
        inputTokens: cumulativeUsage.inputTokens,
        outputTokens: cumulativeUsage.outputTokens,
        cacheCreationTokens: cumulativeUsage.cacheCreationTokens,
        cacheReadTokens: cumulativeUsage.cacheReadTokens,
      }),
      getContextWindowSize: () => contextWindowSize,
      getCompactCount: () => compactSummaries.length,
    },
    mode: {
      getExecutionMode: () => currentExecutionMode,
      setExecutionModeState: (mode) => {
        currentExecutionMode = mode;
      },
      getPermissionMode: () => currentPermissionMode,
      setPermissionModeState: (mode) => {
        currentPermissionMode = mode;
      },
      getCurrentStatus: () => currentStatus,
      getSessionId: () => activeSessionId,
      sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
      runConfigChangeHook: (payload) => hookLifecycle.run("ConfigChange", payload).catch(() => null),
      emitStatusAndTurnState: (nextStatus, reason, force) => emitStatusAndTurnState(nextStatus, reason, force),
      heartbeatTick: () => heartbeat.tick(),
      emitPermissionModeChanged: (mode) => {
        eventBus.emit({ type: "permission-mode-changed", mode });
      },
    },
    preprocessor: {
      getExecutionMode: () => currentExecutionMode,
      getCwd: () => process.cwd(),
      getSessionId: () => activeSessionId,
      contextRefsEnabled,
      runUserPromptSubmitHook: async (payload) => {
        return hookLifecycle.run("UserPromptSubmit", payload).catch(() => null);
      },
      applyPromptContextRefs: (prompt, options) => applyPromptContextRefs(prompt, options),
      terminalSnapshot: () => terminalSnapshotStore.snapshot(80),
      buildAutoMemoryContext: (cwd, maxLines) => buildAutoMemoryContext(cwd, maxLines),
      getOutputStyle: (cwd) => getCurrentOutputStyle(cwd),
      applyOutputStyleToPrompt: (prompt, style) => applyOutputStyleToPrompt(
        prompt,
        style as ReturnType<typeof getCurrentOutputStyle>,
      ),
    },
  });

  const { settleApproval, pickPendingApprovalId, approvalRequestHandler } = createApprovalRuntime({
    pendingApprovals,
    resolveApprovalById: (id, approved) => {
      resolveApproval(id, approved);
    },
    emitApprovalResolved: (requestId, approved) => {
      eventBus.emit({ type: "approval-resolved", sessionId: activeSessionId, requestId, approved });
    },
    getCurrentStatus: () => currentStatus,
    getRunningAgentsSize: () => runningAgents.size,
    emitStatusAndTurnState: (nextStatus, reason, force) => emitStatusAndTurnState(nextStatus, reason, force),
    getExecutionMode: () => currentExecutionMode,
    getPermissionMode: () => currentPermissionMode,
    getApprovalLevel: () => approvalLevel,
    getPermissionRules: () => permissionRules,
    getSandboxPolicy: () => sandboxPolicy,
    getSessionId: () => activeSessionId,
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    runHook: (event, payload) => hookLifecycle.run(event, payload).catch(() => null),
    emitApprovalRequested: (requestId) => {
      eventBus.emit({ type: "approval-requested", sessionId: activeSessionId, requestId });
    },
    sendTelegram,
    sendTelegramMessage,
  });

  const heartbeat = startRuntimeStartup({
    approvalRequestHandler,
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    getStatus: () => currentStatus,
    getDefaultAgent: () => defaultAgent,
    getPermissionMode: () => currentPermissionMode,
    getModelMode: () => currentModelMode,
    getTurnStateVersion: () => getTurnStateVersion(),
    getTurnStateReason: () => getTurnStateReason(),
    runningAgents,
    startTime,
    runSessionStartHook: (payload) => hookLifecycle.run("SessionStart", payload).catch(() => null),
    getSessionId: () => activeSessionId,
    getCwd: () => process.cwd(),
    getExecutionMode: () => currentExecutionMode,
  });

  const configuredMobileIngressMode = resolveIngressNetworkMode(
    process.env.YUANIO_INGRESS_NETWORK_MODE,
    process.env.YUANIO_NETWORK_MODE,
  );
  const resolvePromptSourceByEnvelope = createPromptSourceResolver(configuredMobileIngressMode);

  const { dispatchPrompt, consumeQueueItem, runCompactContext, invokeSkillPrompt } = createPromptRuntimeSetup({
    relay,
    deviceId,
    peerDeviceId,
    getSessionId: () => activeSessionId,
    sendEnvelope,
    sendTelegram,
    sendTelegramMessage,
    runningAgents,
    maxParallel,
    processedPromptIds,
    maxProcessedPrompts,
    getDefaultAgent: () => defaultAgent,
    setStatus: (s, reason) => {
      void emitStatusAndTurnState(s, reason || "prompt_status");
    },
    taskUsageMap,
    taskStartMap,
    nextTaskId,
    getApprovalPort: () => getApprovalPort() || undefined,
    cumulativeUsage,
    runToolResultHook: (event, payload) => hookLifecycle.run(event, payload).catch(() => null),
    runTaskCompletedHook: (payload) => hookLifecycle.run("TaskCompleted", payload).catch(() => null),
    taskRegistry,
    checkpointStore,
    autoTestGateEnabled,
    autoTestGateCmd,
    autoTestGateTimeoutMs,
    emitStatusAndTurnState: (status, reason, force) => emitStatusAndTurnState(status, reason, force),
    recordProcessLine: (line) => terminalSnapshotStore.append(line),
    preprocessPromptForExecution,
    getCwd: () => process.cwd(),
    getContextUsage,
    compactSummaries,
  });
  const dispatchInteractionPrompt = async (
    prompt: string,
    source: "app" | "telegram" | "notification" | "system",
  ): Promise<void> => {
    const envelopeSource = source === "telegram" ? "telegram" : `interaction:${source}`;
    await dispatchPrompt({
      envelope: {
        id: `ia_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        seq: 0,
        source: envelopeSource,
        target: deviceId,
        sessionId: activeSessionId,
        type: MessageType.PROMPT,
        ts: Date.now(),
        payload: "",
      },
      payload: prompt,
      skipAck: true,
      source: source === "telegram" ? "telegram" : "relay",
    });
  };
  const executeUnifiedInteractionAction = (payload: {
    action: "continue" | "stop" | "approve" | "reject" | "retry" | "rollback";
    source?: "app" | "telegram" | "notification" | "system";
    approvalId?: string;
    taskId?: string;
    path?: string;
    prompt?: string;
    reason?: string;
  }) => executeInteractionAction(payload, {
    runningAgents,
    sendStatus: (status, reasonText) => emitStatusAndTurnState(status, reasonText),
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    sendTelegram,
    settleApproval,
    pickPendingApprovalId,
    dispatchPrompt: dispatchInteractionPrompt,
  });

  const { buildRpcDeps, dispatchRpcForTelegram } = createRpcRuntimeSetup({
    sendEnvelope,
    refreshProjectScopedConfig,
    runConfigChangeHook: (ctx) => hookLifecycle.run("ConfigChange", ctx).catch(() => {}),
    getCwd: () => process.cwd(),
    getSessionId: () => activeSessionId,
    emitCwdChangedStatus: () => emitStatusAndTurnState(currentStatus, "cwd_changed", true),
    heartbeatTick: () => heartbeat.tick(),
    getForegroundProbe: getForegroundProbeSnapshot,
    getExecutionMode: () => currentExecutionMode,
    setExecutionMode: (mode, source) => setExecutionMode(mode, source),
    getPermissionMode: () => currentPermissionMode,
    setPermissionModeByRpc,
    listCheckpoints: (limit) => checkpointStore.list(limit),
    restoreCheckpointById,
    runningAgents,
    getQueueSize: () => queueSize(),
    getPendingApprovalsSize: () => pendingApprovals.size,
    getContextUsage,
    compactContext: (instructions) => runCompactContext(instructions),
    resolveCheckpointTarget: (target) => resolveCheckpointTarget(target),
    rewindToMessage: (target, dryRun) => rewindToTarget(target, dryRun),
    taskRegistry,
    getPermissionRulesRef: () => permissionRules,
    setPermissionRulesRef: (next) => {
      permissionRules = next;
    },
    getSandboxPolicyRef: () => sandboxPolicy,
    setSandboxPolicyRef: (next) => {
      sandboxPolicy = next;
    },
    renderStatusline,
    invokeSkill: (name, args) => invokeSkillPrompt(name, args),
  });

  const { webhookHandlers: telegramWebhookHandlers } = createTelegramWiringSetup({
    panels: {
      dispatchRpcForTelegram,
      getPendingApprovals: () => pendingApprovals,
      approvalsPageSizeRaw: process.env.YUANIO_TELEGRAM_APPROVALS_PAGE_SIZE,
    },
    wiring: {
      deviceId,
      getSessionId: () => activeSessionId,
      dispatchPrompt: (params) => dispatchPrompt(params),
      contextWindowSize,
      getRunningAgentsSize: () => runningAgents.size,
      getQueueSize: () => queueSize(),
      getCompactSummariesCount: () => compactSummaries.length,
      getForegroundProbeSnapshot,
      executeInteractionAction: executeUnifiedInteractionAction,
      settleApproval,
      listRecentResumeSessions: () => getRecentResumeSessions(8),
      validateForwardCommand,
      runningAgents,
      emitStatusAndTurnState: (s, reasonText) => emitStatusAndTurnState(s, reasonText),
      sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
      sendTelegram,
      clearQueue: () => clearQueue(),
      buildLoopPrompt,
      loopMaxIterations,
      getStatus: () => currentStatus,
      getExecutionMode: () => currentExecutionMode,
      autoTestGateEnabled,
      autoTestGateCmd,
      getPendingApprovalsSize: () => pendingApprovals.size,
      getCwd: () => process.cwd(),
      getTurnStateVersion: () => getTurnStateVersion(),
      getTurnStateReason: () => getTurnStateReason(),
      setExecutionMode: (mode, source) => setExecutionMode(mode, source),
      formatRunningTasksPanel: () => formatRunningTasksPanel({
        mode: currentExecutionMode,
        runningAgents,
        queueSize: queueSize(),
        pendingApprovals: pendingApprovals.size,
      }),
      listCheckpointText,
      restoreCheckpointById,
    },
  });

  const { buildControlContext, buildNonPromptContext } = createRouterContextSetup({
    deviceId,
    relay,
    getLocalServer: () => localServer,
    runningAgents,
    processedPromptIds,
    sendEnvelope,
    emitStatusAndTurnState: (s, reason, force) => emitStatusAndTurnState(s, reason, force),
    updateSession,
    setDefaultAgent: (agent) => {
      defaultAgent = agent;
      resetAdapters(); // 切换 Agent 时重置 adapter 内部状态
    },
    getDefaultAgent: () => defaultAgent,
    getSessionId: () => activeSessionId,
    getPermissionMode: () => currentPermissionMode,
    getModelMode: () => currentModelMode,
    setModelMode: (mode) => {
      currentModelMode = mode;
    },
    setPermissionModeByRpc,
    getForegroundProbeSnapshot,
    refreshProjectScopedConfig,
    runConfigChangeHook: (ctx) => hookLifecycle.run("ConfigChange", ctx).catch(() => null),
    emitModelModeChanged: (mode) => {
      eventBus.emit({ type: "model-mode-changed", mode });
    },
    heartbeatTick: () => heartbeat.tick(),
    consumeQueueItem,
    maxParallel,
    sendTelegram,
    ptyController,
    settleApproval,
    pickPendingApprovalId,
    dispatchInteractionPrompt,
  });

  const envelopeRuntime = createEnvelopeRuntimeSetup({
    relay,
    routing: {
      deviceId,
      getSessionId: () => activeSessionId,
      getSharedKey: () => activeSharedKey,
      inboundTracker,
      buildControlContext,
      buildRpcDeps: () => buildRpcDeps("app"),
      buildNonPromptContext,
      resolvePromptSource: resolvePromptSourceByEnvelope,
      dispatchPrompt: (params) => dispatchPrompt(params),
    },
    serverUrl,
    getSessionToken: () => activeSessionToken,
    sendEnvelope: (type, plaintext) => sendEnvelope(type, plaintext),
    getSessionId: () => activeSessionId,
  });
  handleEnvelope = envelopeRuntime.handleEnvelope;
  const drainPending = envelopeRuntime.drainPending;
  drainPendingRef = drainPending;

  void emitStatusAndTurnState(currentStatus, "startup", true);

  registerLocalCleanup(localServer);
  const cleanupTimers = await createWebhookSessionCleanup({
    env: process.env,
    handlers: telegramWebhookHandlers,
    commands: TELEGRAM_COMMAND_CATALOG,
    runStopHook: async () => {
      await hookLifecycle.run("Stop", {
        event: "stop",
        sessionId: activeSessionId,
        cwd: process.cwd(),
        runningTasks: runningAgents.size,
      });
    },
    stopHeartbeat: () => heartbeat.stop(),
    stopPty: () => ptyController.stop(),
    deleteTelegramWebhook,
    disposeInboundTracker: () => inboundTracker.dispose(),
  });
  registerRemoteProcessCleanup(cleanupTimers);
}



import { MessageType } from "@yuanio/shared";
import type { Envelope, AgentStatus, UsageInfo, TaskSummaryPayload, IngressPromptSource } from "@yuanio/shared";
import type { RelayClient } from "../relay-client";
import { getAdapter, type NormalizedEvent } from "../adapters";
import { spawnAgent, type AgentType, type AgentHandle, type SpawnOptions } from "../spawn";
import { readTranscriptFallback } from "./transcript-fallback";
import { editTelegramMessage, loadTelegramChatId, sendTelegramChatAction, sendTelegramMessage } from "../telegram";
import { renderMarkdownToTelegramHtml } from "../telegram-markdown";
import {
  MAX_ROUTING_RETRIES,
  isRetryableAgentFailure,
  routeAgentForPrompt,
} from "./agent-router";
import { evaluateCommandSafety } from "./command-safety";

const streamTerminalOutput = process.env.YUANIO_STREAM_TERMINAL_OUTPUT === "1";
const lowPriorityDelayMs = Number(process.env.YUANIO_LOW_PRIORITY_DELAY_MS ?? 12);
const lowPriorityBatchSize = Number(process.env.YUANIO_LOW_PRIORITY_BATCH_SIZE ?? 24);
const HIGH_PRIORITY_KINDS = new Set<NormalizedEvent["kind"]>(["error"]);
const maxStreamEndTextCharsRaw = Number(process.env.YUANIO_STREAM_END_TEXT_MAX_CHARS ?? "");
const maxStreamEndTextChars = Number.isFinite(maxStreamEndTextCharsRaw) && maxStreamEndTextCharsRaw > 0
  ? Math.floor(maxStreamEndTextCharsRaw)
  : 200_000;
const streamChunkSmoothWindowMs = Number(process.env.YUANIO_STREAM_CHUNK_SMOOTH_WINDOW_MS ?? 16);
const streamChunkCatchupWindowMs = Number(process.env.YUANIO_STREAM_CHUNK_CATCHUP_WINDOW_MS ?? 6);
const streamChunkSmoothMaxBytes = Number(process.env.YUANIO_STREAM_CHUNK_SMOOTH_MAX_BYTES ?? 1024);
const streamChunkCatchupMaxBytes = Number(process.env.YUANIO_STREAM_CHUNK_CATCHUP_MAX_BYTES ?? 4096);
const streamChunkCatchupBacklog = Number(process.env.YUANIO_STREAM_CHUNK_CATCHUP_BACKLOG ?? 4);
const thinkingThrottleMs = Number(process.env.YUANIO_THINKING_THROTTLE_MS ?? 120);
const preOutputThinkingEnabled = process.env.YUANIO_PRE_OUTPUT_THINKING !== "0";
const preOutputThinkingIntervalMs = Number(process.env.YUANIO_PRE_OUTPUT_THINKING_INTERVAL_MS ?? 1200);
const preOutputThinkingMaxTicks = Number(process.env.YUANIO_PRE_OUTPUT_THINKING_MAX_TICKS ?? 15);
const telegramLiveIntervalMs = Number(process.env.YUANIO_TELEGRAM_LIVE_INTERVAL_MS ?? 1200);
const telegramTypingIntervalMs = Number(process.env.YUANIO_TELEGRAM_TYPING_INTERVAL_MS ?? 4000);
const telegramLiveLayout = String(process.env.YUANIO_TELEGRAM_LIVE_LAYOUT || "output_first").trim().toLowerCase();
const telegramShellFallbackEnabled = process.env.YUANIO_TELEGRAM_SHELL_FALLBACK !== "0";
const telegramShellFallbackTimeoutMs = Number(process.env.YUANIO_TELEGRAM_SHELL_FALLBACK_TIMEOUT_MS ?? 20_000);

function normalizeInt(value: number, fallback: number, min = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

const normalizedStreamChunkSmoothWindowMs = normalizeInt(streamChunkSmoothWindowMs, 16, 0);
const normalizedStreamChunkCatchupWindowMs = normalizeInt(streamChunkCatchupWindowMs, 6, 0);
const normalizedStreamChunkSmoothMaxBytes = normalizeInt(streamChunkSmoothMaxBytes, 1024, 128);
const normalizedStreamChunkCatchupMaxBytes = Math.max(
  normalizedStreamChunkSmoothMaxBytes,
  normalizeInt(streamChunkCatchupMaxBytes, 4096, 256),
);
const normalizedStreamChunkCatchupBacklog = normalizeInt(streamChunkCatchupBacklog, 4, 1);
const normalizedThinkingThrottleMs = normalizeInt(thinkingThrottleMs, 120, 0);
const normalizedPreOutputThinkingIntervalMs = normalizeInt(preOutputThinkingIntervalMs, 1200, 200);
const normalizedPreOutputThinkingMaxTicks = normalizeInt(preOutputThinkingMaxTicks, 15, 1);
const normalizedTelegramShellFallbackTimeoutMs = normalizeInt(telegramShellFallbackTimeoutMs, 20_000, 2_000);

export interface PromptTaskReport {
  taskId: string;
  promptId: string;
  agent: AgentType;
  prompt: string;
  source: IngressPromptSource;
  success: boolean;
  changedFiles: string[];
  cwd: string;
  error?: string;
}

const SHELL_COMMAND_HINTS = new Set([
  "ls", "dir", "pwd", "cd", "cat", "type", "echo",
  "rg", "grep", "find", "where", "which",
  "git", "bun", "npm", "pnpm", "node", "python", "pip",
  "curl", "wget", "ping",
  "ps", "tasklist", "kill", "taskkill",
  "docker", "kubectl",
]);

function stripShellFallbackPrefix(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("!") ? trimmed.slice(1).trim() : trimmed;
}

function looksLikeShellCommand(input: string): boolean {
  const text = stripShellFallbackPrefix(input);
  if (!text) return false;
  if (text.startsWith("/")) return false;
  if (/[\u4e00-\u9fff]/.test(text) && !/[|&;<>`$]/.test(text)) return false;
  if (/[|&;<>`$]/.test(text)) return true;
  const first = text.split(/\s+/)[0]?.toLowerCase() || "";
  if (!first) return false;
  if (SHELL_COMMAND_HINTS.has(first)) return true;
  if (first.includes("/") || first.includes("\\") || first.endsWith(".ps1") || first.endsWith(".sh") || first.endsWith(".cmd")) return true;
  return false;
}

function isAgentUnavailableError(errorText: string): boolean {
  return /\[spawn\]/i.test(errorText)
    || /未检测到/i.test(errorText)
    || /not found/i.test(errorText)
    || /not in PATH/i.test(errorText)
    || /exited with code 127/i.test(errorText);
}

function shouldUseTelegramShellFallback(
  source: IngressPromptSource | undefined,
  prompt: string,
  errorText: string,
): boolean {
  if (source !== "telegram") return false;
  if (!telegramShellFallbackEnabled) return false;
  if (!looksLikeShellCommand(prompt)) return false;
  return isAgentUnavailableError(errorText);
}

async function runTelegramShellCommand(command: string, timeoutMs: number): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  cwd: string;
}> {
  const args = process.platform === "win32"
    ? ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
    : ["sh", "-lc", command];
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
    env: { ...process.env, TERM: "dumb" },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch {}
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      stdout,
      stderr,
      exitCode: typeof exitCode === "number" ? exitCode : 1,
      timedOut,
      cwd: process.cwd(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function truncateShellOutput(text: string, maxChars = 3200): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}\n...(truncated)`;
}

function renderShellFallbackText(command: string, result: {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  cwd: string;
}): string {
  const lines: string[] = [
    "Shell fallback 已执行",
    "",
    "```sh",
    `$ ${command}`,
    "```",
    `cwd: ${result.cwd}`,
    `exit: ${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
  ];
  const stdout = truncateShellOutput(result.stdout.trim(), 2600);
  const stderr = truncateShellOutput(result.stderr.trim(), 1800);
  if (stdout) {
    lines.push("", "stdout", "```text", stdout, "```");
  }
  if (stderr) {
    lines.push("", "stderr", "```text", stderr, "```");
  }
  if (!stdout && !stderr) {
    lines.push("", "(no output)");
  }
  return lines.join("\n");
}

function renderShellSafetyBlockedText(command: string, reason: string): string {
  return [
    "Shell fallback 已拦截",
    "",
    "```sh",
    `$ ${command}`,
    "```",
    reason,
  ].join("\n");
}

export async function handlePrompt(params: {
  envelope: Envelope;
  payload: string;
  relay: RelayClient;
  deviceId: string;
  activeSessionId: string;
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  processedPromptIds: Map<string, number>;
  maxProcessedPrompts: number;
  defaultAgent: AgentType;
  setStatus: (s: AgentStatus, reason?: string) => void;
  taskUsageMap: Map<string, UsageInfo>;
  taskStartMap: Map<string, number>;
  nextTaskId: () => string;
  approvalPort?: number;
  agentOverride?: AgentType;
  resumeSessionId?: string;
  skipAck?: boolean;
  skipParallelCheck?: boolean;
  maxParallel?: number;
  enqueuePrompt?: (prompt: string, agent?: AgentType) => Promise<void>;
  dispatchEvent: (
    ev: NormalizedEvent,
    agent: string,
    sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number) => Promise<void>,
    statusCount: number,
    taskId: string | undefined,
  ) => Promise<void>;
  collectTaskSummary: (taskId: string) => Promise<TaskSummaryPayload>;
  processQueue: (sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>) => void;
  sendTelegram: (message: string) => void;
  logEvent?: (event: Record<string, unknown>) => void;
  source?: IngressPromptSource;
  onTaskStarted?: (info: {
    taskId: string;
    promptId: string;
    prompt: string;
    agent: AgentType;
    source: IngressPromptSource;
    stop: () => void;
  }) => Promise<void> | void;
  onTaskFinished?: (report: PromptTaskReport) => Promise<void> | void;
  onTaskOutput?: (taskId: string, line: string) => Promise<void> | void;
  recordProcessLine?: (line: string) => void;
  routingAttempt?: number;
  routingTriedAgents?: AgentType[];
}): Promise<void> {
  const {
    envelope,
    payload,
    relay,
    deviceId,
    activeSessionId,
    sendEnvelope,
    runningAgents,
    processedPromptIds,
    maxProcessedPrompts,
    defaultAgent,
    setStatus,
    taskUsageMap,
    taskStartMap,
    nextTaskId,
    approvalPort,
    agentOverride,
    resumeSessionId,
    skipAck,
    skipParallelCheck,
    maxParallel,
    enqueuePrompt,
    dispatchEvent,
    collectTaskSummary,
    processQueue,
    sendTelegram,
    logEvent,
    source,
    onTaskStarted,
    onTaskFinished,
    onTaskOutput,
    recordProcessLine,
    routingAttempt = 0,
    routingTriedAgents = [],
  } = params;

  const promptId = envelope.id;
  if (!skipAck) {
    if (promptId && processedPromptIds.has(promptId)) {
      relay.sendAck(promptId, deviceId, activeSessionId, "ok", { reason: "duplicate" });
      console.log(`[remote] 重复 prompt 已忽略: ${promptId}`);
      return;
    }
    relay.sendAck(envelope.id, deviceId, activeSessionId, "working");
  }
  if (promptId) {
    processedPromptIds.set(promptId, Date.now());
    if (processedPromptIds.size > maxProcessedPrompts) {
      const oldest = processedPromptIds.keys().next().value as string | undefined;
      if (oldest) processedPromptIds.delete(oldest);
    }
  }

  if (!skipParallelCheck && maxParallel && runningAgents.size >= maxParallel) {
    if (enqueuePrompt) {
      await enqueuePrompt(payload, agentOverride ?? defaultAgent);
      logEvent?.({
        type: "prompt_queued",
        taskId: promptId,
        agent: agentOverride ?? defaultAgent,
        source: source ?? "relay",
        reason: "max_parallel",
      });
      return;
    }
  }

  const taskId = nextTaskId();
  const recvAt = Date.now();
  let firstOutputLogged = false;

  taskUsageMap.set(taskId, { inputTokens: 0, outputTokens: 0 });
  taskStartMap.set(taskId, recvAt);

  console.log(`[remote] 收到 prompt (${taskId}):`, payload);
  if (typeof envelope.ts === "number") {
    console.log(`[remote] send→cli (${taskId}|${promptId}): ${recvAt - envelope.ts}ms`);
  }
  if (typeof envelope.relayTs === "number") {
    console.log(`[remote] relay→cli (${taskId}|${promptId}): ${recvAt - envelope.relayTs}ms`);
    if (typeof envelope.ts === "number") {
      console.log(`[remote] send→relay (${taskId}|${promptId}): ${envelope.relayTs - envelope.ts}ms`);
    }
  }
  if (source !== "telegram") {
    sendTelegram(`收到远程 prompt (${taskId}):\n${payload.slice(0, 200)}`);
  }

  setStatus("running", "prompt_start");

  const routeDecision = routeAgentForPrompt({
    prompt: payload,
    defaultAgent,
    agentOverride,
    source,
    triedAgents: routingTriedAgents,
  });
  const agentToUse = routeDecision.agent;
  const spawnOpts: SpawnOptions = {
    agent: agentToUse,
    approvalPort: approvalPort || undefined,
    resumeSessionId,
  };
  const adapter = getAdapter(agentToUse);
  const agentName = agentToUse;
  logEvent?.({
    type: "model_routing",
    taskId,
    promptId,
    selected: routeDecision.agent,
    strategy: routeDecision.strategy,
    reason: routeDecision.reason,
    fallbackChain: routeDecision.fallbackChain,
    scores: routeDecision.scores,
    source: source ?? "unknown",
    routingAttempt,
  });
  let statusCount = 0;
  let streamedText = "";
  const changedFiles = new Set<string>();
  const preOutputTurnId = `pre_output_${taskId}`;
  let preOutputThinkingTimer: ReturnType<typeof setInterval> | null = null;
  let preOutputThinkingStarted = false;
  let preOutputThinkingTick = 0;
  const lowPriorityQueue: Array<() => Promise<void>> = [];
  let lowPriorityScheduled = false;
  let lowPriorityDraining = false;
  let outputChain: Promise<void> = Promise.resolve();
  let bufferedText = "";
  let bufferedTextBytes = 0;
  let bufferedTextFragments = 0;
  let textFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let firstChunkSent = false;
  let pendingThinking: { thinking: string; turnId?: string } | null = null;
  let thinkingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const enqueueLowPriority = (task: () => Promise<void>) => {
    lowPriorityQueue.push(task);
    if (lowPriorityScheduled || lowPriorityDraining) return;
    lowPriorityScheduled = true;
    setTimeout(() => {
      lowPriorityScheduled = false;
      void drainLowPriority();
    }, Math.max(0, lowPriorityDelayMs));
  };

  const runSafeTask = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      console.warn("[remote] low-priority dispatch failed:", error);
    }
  };

  const drainLowPriority = async () => {
    if (lowPriorityDraining) return;
    lowPriorityDraining = true;
    try {
      while (lowPriorityQueue.length > 0) {
        const batch = lowPriorityQueue.splice(0, Math.max(1, lowPriorityBatchSize));
        for (const task of batch) {
          await runSafeTask(task);
        }
        if (lowPriorityQueue.length > 0) {
          await new Promise<void>((resolveFn) => setTimeout(resolveFn, Math.max(0, lowPriorityDelayMs)));
        }
      }
    } finally {
      lowPriorityDraining = false;
    }
  };

  const scheduleOutput = (task: () => Promise<void>): Promise<void> => {
    outputChain = outputChain.then(task).catch((error) => {
      console.warn("[remote] output dispatch failed:", error);
    });
    return outputChain;
  };

  const telegramChatId = source === "telegram" ? loadTelegramChatId() : null;
  const telegramLiveEnabled = !!telegramChatId;
  const normalizedTelegramLiveIntervalMs = normalizeInt(telegramLiveIntervalMs, 1200, 200);
  const normalizedTelegramTypingIntervalMs = normalizeInt(telegramTypingIntervalMs, 4000, 1000);
  let telegramLiveMsgId: number | null = null;
  let telegramUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let telegramTypingTimer: ReturnType<typeof setInterval> | null = null;
  let telegramLastUpdateAt = 0;
  let telegramLastRenderSig = "";
  let telegramLastInteractiveSig = "";
  let telegramLastSentSig = "";
  let telegramSendBackoffUntil = 0;
  const telegramToolLines: string[] = [];
  const telegramSeenToolEventKeys = new Map<string, number>();

  const clampTelegramText = (text: string, max = 3900, keepTail = false): string => {
    if (text.length <= max) return text;
    if (keepTail) {
      const marker = "...(truncated)\n";
      const size = Math.max(0, max - marker.length);
      return `${marker}${text.slice(-size)}`;
    }
    const marker = "\n...(truncated)";
    const size = Math.max(0, max - marker.length);
    return `${text.slice(0, size)}${marker}`;
  };

  const escapeTelegramHtml = (text: string): string => text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const detectInteractiveOptions = (text: string): Array<{ num: string; label: string }> => {
    const lines = text.split(/\r?\n/).slice(-20);
    const seen = new Set<string>();
    const items: Array<{ num: string; label: string }> = [];
    for (const line of lines) {
      const m = line.match(/^\s*(?:❯\s*)?(\d{1,2})\.\s+(.+)$/);
      if (!m) continue;
      const num = m[1];
      if (seen.has(num)) continue;
      seen.add(num);
      items.push({ num, label: m[2].trim() });
      if (items.length >= 8) break;
    }
    return items;
  };

  const buildInteractiveMarkup = (): Record<string, unknown> | undefined => {
    const tail = streamedText.slice(-1600);
    if (!tail) return undefined;
    const options = detectInteractiveOptions(tail);
    const lower = tail.toLowerCase();
    const hasYesNo = /(?:\(y\/n\)|\(yes\/no\)|\by\/n\b|\byes\/no\b)/i.test(tail);
    const hasEnter = /enter to select|press enter|continue\?/i.test(lower);
    const hasEsc = /\besc\b|cancel/i.test(lower);
    const looksInteractive = options.length > 0 || hasYesNo || hasEnter || hasEsc;
    if (!looksInteractive) return undefined;

    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const option of options) {
      const label = `${option.num}. ${option.label}`;
      rows.push([{
        text: label.length > 42 ? `${label.slice(0, 40)}..` : label,
        callback_data: `in:opt:${option.num}`,
      }]);
    }
    if (hasYesNo) {
      rows.push([
        { text: "Yes", callback_data: "in:y" },
        { text: "No", callback_data: "in:n" },
      ]);
    }
    rows.push([
      { text: "Enter", callback_data: "in:enter" },
      { text: "Esc", callback_data: "in:esc" },
    ]);
    return { inline_keyboard: rows };
  };

  const buildTelegramLiveText = (): { plain: string; html: string } => {
    const output = streamedText.trim();
    const outputTail = output ? clampTelegramText(output, 2500, true) : "(waiting first output)";
    const process = telegramToolLines.slice(-8).join("\n");
    const plainText = process
      ? (
        telegramLiveLayout === "process_first"
          ? [
            `TASK ${taskId} · ${agentName}`,
            "",
            "Process",
            process,
            "",
            "Output",
            outputTail,
          ].join("\n")
          : [
            `TASK ${taskId} · ${agentName}`,
            "",
            "Output",
            outputTail,
            "",
            "Process",
            process,
          ].join("\n")
      )
      : [
        `TASK ${taskId} · ${agentName}`,
        "",
        outputTail,
      ].join("\n");
    const title = `TASK ${taskId} · ${agentName}`;
    const renderedOutput = renderMarkdownToTelegramHtml(outputTail);
    const htmlText = process
      ? (
        telegramLiveLayout === "process_first"
          ? [
            `<b>${escapeTelegramHtml(title)}</b>`,
            "",
            "<b>Process</b>",
            `<pre>${escapeTelegramHtml(process)}</pre>`,
            "",
            "<b>Output</b>",
            renderedOutput,
          ].join("\n")
          : [
            `<b>${escapeTelegramHtml(title)}</b>`,
            "",
            "<b>Output</b>",
            renderedOutput,
            "",
            "<b>Process</b>",
            `<pre>${escapeTelegramHtml(process)}</pre>`,
          ].join("\n")
      )
      : [
        `<b>${escapeTelegramHtml(title)}</b>`,
        "",
        renderedOutput,
      ].join("\n");
    return {
      plain: clampTelegramText(plainText, 3900, true),
      html: htmlText,
    };
  };

  const updateTelegramLiveNow = async (force = false) => {
    if (!telegramLiveEnabled || !telegramChatId) return;
    const rendered = buildTelegramLiveText();
    const text = rendered.plain;
    const replyMarkup = buildInteractiveMarkup();
    const interactiveSig = replyMarkup ? JSON.stringify(replyMarkup) : "";
    const renderSig = `${text}\n@@${interactiveSig}`;
    if (!force && renderSig === telegramLastRenderSig) return;
    telegramLastRenderSig = renderSig;

    // 若之前有按钮，本轮不需要时用空键盘清理。
    const markupToSend = replyMarkup
      || (telegramLastInteractiveSig ? { inline_keyboard: [] } : undefined);

    if (telegramLiveMsgId) {
      const ok = await editTelegramMessage(telegramChatId, telegramLiveMsgId, rendered.html, markupToSend, "HTML");
      if (!ok) {
        telegramLiveMsgId = null;
      } else {
        telegramLastSentSig = renderSig;
      }
    }
    if (!telegramLiveMsgId) {
      if (!force && Date.now() < telegramSendBackoffUntil) return;
      if (!force && renderSig === telegramLastSentSig) return;
      const newId = await sendTelegramMessage({
        chatId: telegramChatId,
        text: rendered.html,
        parseMode: "HTML",
        replyMarkup: markupToSend,
        disableNotification: true,
      });
      if (typeof newId === "number") {
        telegramLiveMsgId = newId;
        telegramLastSentSig = renderSig;
        telegramSendBackoffUntil = 0;
      } else {
        telegramSendBackoffUntil = Date.now() + 5_000;
      }
    }
    telegramLastInteractiveSig = interactiveSig;
    telegramLastUpdateAt = Date.now();
  };

  const scheduleTelegramLiveUpdate = (force = false) => {
    if (!telegramLiveEnabled) return;
    if (force) {
      if (telegramUpdateTimer) {
        clearTimeout(telegramUpdateTimer);
        telegramUpdateTimer = null;
      }
      void scheduleOutput(() => updateTelegramLiveNow(true));
      return;
    }
    if (telegramUpdateTimer) return;
    const elapsed = Date.now() - telegramLastUpdateAt;
    const waitMs = Math.max(0, normalizedTelegramLiveIntervalMs - elapsed);
    telegramUpdateTimer = setTimeout(() => {
      telegramUpdateTimer = null;
      void scheduleOutput(() => updateTelegramLiveNow(false));
    }, waitMs);
  };

  const startTelegramTyping = () => {
    if (!telegramLiveEnabled || !telegramChatId) return;
    void sendTelegramChatAction(telegramChatId, "typing");
    telegramTypingTimer = setInterval(() => {
      void sendTelegramChatAction(telegramChatId, "typing");
    }, normalizedTelegramTypingIntervalMs);
  };

  const stopTelegramTyping = () => {
    if (telegramTypingTimer) {
      clearInterval(telegramTypingTimer);
      telegramTypingTimer = null;
    }
  };

  const pushTelegramToolLine = (line: string | null) => {
    if (!telegramLiveEnabled || !line) return;
    telegramToolLines.push(line);
    if (telegramToolLines.length > 60) {
      telegramToolLines.splice(0, telegramToolLines.length - 60);
    }
  };

  const normalizePreviewValue = (value: unknown, depth = 0): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => normalizePreviewValue(item, depth + 1))
        .filter((item) => item.length > 0)
        .join(" ")
        .trim();
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const preferred = ["command", "cmd", "shell_command", "input", "args", "argv", "script", "query", "path", "url", "prompt"];
      for (const key of preferred) {
        const preview = normalizePreviewValue(obj[key], depth + 1);
        if (preview) return preview;
      }
      if (depth <= 1) {
        try {
          return JSON.stringify(obj);
        } catch {
          return "";
        }
      }
    }
    return "";
  };

  const compactText = (value: unknown, max = 120): string => {
    const raw = normalizePreviewValue(value);
    if (!raw) return "";
    const oneLine = raw.replace(/\s+/g, " ").trim();
    if (!oneLine) return "";
    if (oneLine.length <= max) return oneLine;
    return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
  };

  const summarizeToolParamsForTelegram = (ev: Extract<NormalizedEvent, { kind: "tool_call" }>): string => {
    const params = ev.params || {};
    if (ev.tool === "command_execution" || ev.tool === "bash") {
      const cmd = compactText(
        params.command ?? params.cmd ?? params.shell_command ?? params.input ?? params.args ?? params.argv ?? params.script,
        180,
      );
      return cmd ? `$ ${cmd}` : "";
    }
    const preferredKeys = ["query", "path", "file_path", "url", "prompt", "description", "pattern"];
    for (const key of preferredKeys) {
      const preview = compactText(params[key], 96);
      if (preview) return `${key}=${preview}`;
    }
    return "";
  };

  const registerToolEventKey = (key: string): boolean => {
    const now = Date.now();
    const ttl = 5 * 60 * 1000;
    for (const [k, ts] of telegramSeenToolEventKeys) {
      if (now - ts > ttl) {
        telegramSeenToolEventKeys.delete(k);
        continue;
      }
      break;
    }
    if (telegramSeenToolEventKeys.has(key)) return false;
    telegramSeenToolEventKeys.set(key, now);
    if (telegramSeenToolEventKeys.size > 600) {
      const oldest = telegramSeenToolEventKeys.keys().next().value as string | undefined;
      if (oldest) telegramSeenToolEventKeys.delete(oldest);
    }
    return true;
  };

  const formatToolEventForTelegram = (ev: NormalizedEvent): string | null => {
    if (ev.kind === "tool_call") {
      const mark = ev.status === "done" ? "[DONE]" : ev.status === "running" ? "[RUN]" : "[TOOL]";
      const detail = summarizeToolParamsForTelegram(ev);
      const line = detail
        ? ev.tool === "command_execution"
          ? `${mark} ${ev.tool} (${ev.status})\n${detail}`
          : `${mark} ${ev.tool} (${ev.status}) ${detail}`
        : `${mark} ${ev.tool} (${ev.status})`;
      const key = ev.toolUseId
        ? `call:${ev.status}:${ev.toolUseId}`
        : `call:${ev.status}:${line}`;
      return registerToolEventKey(key) ? line : null;
    }
    if (ev.kind === "tool_result") {
      const resultPreview = compactText(ev.result, ev.tool === "command_execution" || ev.tool === "bash" ? 180 : 100);
      const includePreview = !!resultPreview && (ev.status === "error" || ev.tool === "command_execution" || ev.tool === "bash");
      const line = includePreview
        ? (ev.tool === "command_execution" || ev.tool === "bash")
          ? `[RESULT] ${ev.tool} (${ev.status})\n${resultPreview}`
          : `[RESULT] ${ev.tool} (${ev.status}) ${resultPreview}`
        : `[RESULT] ${ev.tool}`;
      const key = ev.toolUseId
        ? `result:${ev.status}:${ev.toolUseId}`
        : `result:${ev.status}:${line}`;
      return registerToolEventKey(key) ? line : null;
    }
    if (ev.kind === "hook_event") {
      return `[HOOK] ${ev.hook}${ev.tool ? ` · ${ev.tool}` : ""}`;
    }
    if (ev.kind === "error") {
      return `[ERROR] ${ev.message.slice(0, 180)}`;
    }
    return null;
  };

  const finalizeTelegramLive = async (finalText: string, mode: "done" | "error" | "fallback") => {
    if (!telegramLiveEnabled || !telegramChatId) return;
    if (telegramUpdateTimer) {
      clearTimeout(telegramUpdateTimer);
      telegramUpdateTimer = null;
    }
    stopTelegramTyping();
    await updateTelegramLiveNow(true);

    const processLog = telegramToolLines.join("\n").trim();
    const finalOutput = (finalText || streamedText || "").trim();
    const finalOutputText = clampTelegramText(finalOutput || (mode === "done" ? "任务完成" : "任务失败"), 3900, true);
    const finalOutputHtml = renderMarkdownToTelegramHtml(finalOutputText);
    const finalSig = `final:${finalOutputText}`;

    if (!telegramLiveMsgId) {
      if (telegramLastSentSig !== finalSig) {
        const sentId = await sendTelegramMessage({ chatId: telegramChatId, text: finalOutputHtml, parseMode: "HTML" });
        if (typeof sentId === "number") {
          telegramLastSentSig = finalSig;
        }
      }
      telegramLastInteractiveSig = "";
      return;
    }

    if (processLog && finalOutput) {
      const processText = clampTelegramText(processLog, 3200, true);
      const processHtml = [
        "<b>Process</b>",
        `<pre>${escapeTelegramHtml(processText)}</pre>`,
      ].join("\n");
      const processEdited = await editTelegramMessage(
        telegramChatId,
        telegramLiveMsgId,
        processHtml,
        { inline_keyboard: [] },
        "HTML",
      );
      if (processEdited) {
        if (telegramLastSentSig !== finalSig) {
          const sentId = await sendTelegramMessage({
            chatId: telegramChatId,
            text: finalOutputHtml,
            parseMode: "HTML",
          });
          if (typeof sentId === "number") {
            telegramLastSentSig = finalSig;
          }
        }
        telegramLastInteractiveSig = "";
        return;
      }
    }

    const finalEdited = await editTelegramMessage(
      telegramChatId,
      telegramLiveMsgId,
      finalOutputHtml,
      { inline_keyboard: [] },
      "HTML",
    );
    if (finalEdited) {
      telegramLastSentSig = finalSig;
    }
    if (!finalEdited) {
      if (telegramLastSentSig !== finalSig) {
        const sentId = await sendTelegramMessage({
          chatId: telegramChatId,
          text: finalOutputHtml,
          parseMode: "HTML",
        });
        if (typeof sentId === "number") {
          telegramLastSentSig = finalSig;
        }
      }
    }
    telegramLastInteractiveSig = "";
  };

  const flushTextNow = async () => {
    if (textFlushTimer) {
      clearTimeout(textFlushTimer);
      textFlushTimer = null;
    }
    if (!bufferedText) return;
    const text = bufferedText;
    bufferedText = "";
    bufferedTextBytes = 0;
    bufferedTextFragments = 0;
    await sendEnvelope(MessageType.STREAM_CHUNK, text);
  };

  const scheduleTextFlush = (delayMs: number) => {
    if (textFlushTimer) return;
    textFlushTimer = setTimeout(() => {
      textFlushTimer = null;
      void scheduleOutput(flushTextNow);
    }, Math.max(0, delayMs));
  };

  const enqueueTextChunk = async (chunk: string) => {
    if (!chunk) return;
    bufferedText += chunk;
    bufferedTextBytes += Buffer.byteLength(chunk);
    bufferedTextFragments += 1;

    if (!firstChunkSent) {
      firstChunkSent = true;
      await flushTextNow();
      return;
    }

    const catchupMode = bufferedTextFragments >= normalizedStreamChunkCatchupBacklog
      || bufferedTextBytes >= normalizedStreamChunkCatchupMaxBytes;
    const maxBytes = catchupMode
      ? normalizedStreamChunkCatchupMaxBytes
      : normalizedStreamChunkSmoothMaxBytes;
    if (bufferedTextBytes >= maxBytes) {
      await flushTextNow();
      return;
    }
    scheduleTextFlush(catchupMode ? normalizedStreamChunkCatchupWindowMs : normalizedStreamChunkSmoothWindowMs);
  };

  const flushThinkingNow = async () => {
    if (thinkingFlushTimer) {
      clearTimeout(thinkingFlushTimer);
      thinkingFlushTimer = null;
    }
    if (!pendingThinking) return;
    const ev: NormalizedEvent = {
      kind: "thinking",
      thinking: pendingThinking.thinking,
      turnId: pendingThinking.turnId,
    };
    pendingThinking = null;
    await dispatchEvent(ev, agentName, sendEnvelope, statusCount, taskId);
  };

  const scheduleThinkingFlush = () => {
    if (thinkingFlushTimer) return;
    thinkingFlushTimer = setTimeout(() => {
      thinkingFlushTimer = null;
      void scheduleOutput(flushThinkingNow);
    }, Math.max(0, normalizedThinkingThrottleMs));
  };

  const enqueueThinking = async (thinking: string, turnId?: string) => {
    pendingThinking = { thinking, turnId };
    if (normalizedThinkingThrottleMs === 0) {
      await flushThinkingNow();
      return;
    }
    scheduleThinkingFlush();
  };

  const flushBufferedOutputs = async () => {
    await flushTextNow();
    await flushThinkingNow();
  };

  const sendPreOutputThinking = async (done: boolean) => {
    const payload = done
      ? {
          thinking: "",
          turnId: preOutputTurnId,
          agent: agentName,
          ephemeral: true,
          done: true,
          phase: "pre_output",
          elapsedMs: Date.now() - recvAt,
        }
      : {
          thinking: `等待 ${agentName} 首包中${".".repeat((preOutputThinkingTick % 3) + 1)}`,
          turnId: preOutputTurnId,
          agent: agentName,
          ephemeral: true,
          done: false,
          phase: "pre_output",
          elapsedMs: Date.now() - recvAt,
        };
    await sendEnvelope(MessageType.THINKING, JSON.stringify(payload));
  };

  const stopPreOutputThinking = () => {
    if (preOutputThinkingTimer) {
      clearInterval(preOutputThinkingTimer);
      preOutputThinkingTimer = null;
    }
    if (!preOutputThinkingStarted) return;
    preOutputThinkingStarted = false;
    void scheduleOutput(() => sendPreOutputThinking(true));
  };

  const startPreOutputThinking = () => {
    if (!preOutputThinkingEnabled || preOutputThinkingStarted) return;
    preOutputThinkingStarted = true;
    preOutputThinkingTick = 0;
    void scheduleOutput(() => sendPreOutputThinking(false));
    preOutputThinkingTimer = setInterval(() => {
      if (!preOutputThinkingStarted || firstOutputLogged) return;
      preOutputThinkingTick += 1;
      if (preOutputThinkingTick >= normalizedPreOutputThinkingMaxTicks) {
        stopPreOutputThinking();
        return;
      }
      void scheduleOutput(() => sendPreOutputThinking(false));
    }, normalizedPreOutputThinkingIntervalMs);
  };

  const handle = spawnAgent(payload, (msg: unknown) => {
    if (!firstOutputLogged) {
      firstOutputLogged = true;
      stopPreOutputThinking();
      const firstAt = Date.now();
      console.log(`[remote] cli_recv→first_output (${taskId}|${promptId}): ${firstAt - recvAt}ms`);
      if (typeof envelope.relayTs === "number") {
        console.log(`[remote] relay→first_output (${taskId}|${promptId}): ${firstAt - envelope.relayTs}ms`);
      }
      if (typeof envelope.ts === "number") {
        console.log(`[remote] send→first_output (${taskId}|${promptId}): ${firstAt - envelope.ts}ms`);
      }
    }

    void scheduleOutput(async () => {
      const events = adapter(msg);
      if (streamTerminalOutput) {
        enqueueLowPriority(() => sendEnvelope(MessageType.TERMINAL_OUTPUT, JSON.stringify(msg)));
      }
      for (const ev of events) {
        if (ev.kind === "text" && typeof ev.text === "string" && ev.text.length > 0) {
          if (streamedText.length < maxStreamEndTextChars) {
            const remaining = maxStreamEndTextChars - streamedText.length;
            streamedText += remaining > 0 ? ev.text.slice(0, remaining) : "";
          }
          void Promise.resolve(onTaskOutput?.(taskId, ev.text)).catch(() => {});
        }
        if (ev.kind === "text") {
          await enqueueTextChunk(ev.text);
          scheduleTelegramLiveUpdate(false);
          continue;
        }
        if (ev.kind === "thinking") {
          await enqueueThinking(ev.thinking, ev.turnId);
          continue;
        }
        if (ev.kind === "file_diff" && typeof ev.path === "string" && ev.path.trim()) {
          changedFiles.add(ev.path.trim());
        }
        const processLine = formatToolEventForTelegram(ev);
        pushTelegramToolLine(processLine);
        if (processLine) recordProcessLine?.(processLine);
        if (processLine) void Promise.resolve(onTaskOutput?.(taskId, processLine)).catch(() => {});
        scheduleTelegramLiveUpdate(false);
        const dispatchTask = async () => {
          await dispatchEvent(ev, agentName, sendEnvelope, statusCount, taskId);
          if (ev.kind === "status") statusCount++;
        };
        if (HIGH_PRIORITY_KINDS.has(ev.kind)) {
          await flushBufferedOutputs();
          await dispatchTask();
        } else {
          enqueueLowPriority(dispatchTask);
        }
      }
    });
  }, spawnOpts);

  runningAgents.set(taskId, { handle, agent: agentToUse });
  if (onTaskStarted) {
    try {
      await onTaskStarted({
        taskId,
        promptId,
        prompt: payload,
        agent: agentToUse,
        source: source ?? "unknown",
        stop: () => handle.kill(),
      });
    } catch {
      // ignore task registry callback failures
    }
  }
  startPreOutputThinking();
  startTelegramTyping();
  scheduleTelegramLiveUpdate(true);
  logEvent?.({
    type: "prompt_start",
    taskId,
    agent: agentToUse,
    source: source ?? "relay",
    promptLength: payload.length,
  });

  handle.promise.then(async () => {
    runningAgents.delete(taskId);
    stopPreOutputThinking();
    stopTelegramTyping();

    await scheduleOutput(flushBufferedOutputs);
    await drainLowPriority();
    const summary = await collectTaskSummary(taskId);
    await sendEnvelope(MessageType.TASK_SUMMARY, JSON.stringify(summary));
    const endPayload = streamedText
      ? { taskId, finalText: streamedText }
      : { taskId };
    await sendEnvelope(MessageType.STREAM_END, JSON.stringify(endPayload));

    taskUsageMap.delete(taskId);
    taskStartMap.delete(taskId);

    if (runningAgents.size === 0) setStatus("idle", "prompt_done");
    if (!skipAck && promptId) {
      relay.sendAck(promptId, deviceId, activeSessionId, "ok");
    }
    if (source === "telegram") {
      await finalizeTelegramLive(streamedText, "done");
    } else {
      sendTelegram(`任务完成 (${taskId})`);
    }
    if (onTaskFinished) {
      try {
        await onTaskFinished({
          taskId,
          promptId,
          agent: agentToUse,
          prompt: payload,
          source: source ?? "unknown",
          success: true,
          changedFiles: Array.from(changedFiles),
          cwd: process.cwd(),
        });
      } catch (reportError) {
        console.warn("[remote] onTaskFinished failed:", reportError);
      }
    }
    logEvent?.({ type: "prompt_done", taskId, agent: agentToUse });

    processQueue(sendEnvelope);
  }).catch((err) => {
    runningAgents.delete(taskId);
    stopPreOutputThinking();
    stopTelegramTyping();
    const errorText = err instanceof Error ? err.message : String(err);
    const shellFallbackPrompt = stripShellFallbackPrefix(payload);
    const shouldRunShellFallback = shouldUseTelegramShellFallback(source, payload, errorText);

    void scheduleOutput(flushBufferedOutputs);
    void drainLowPriority();
    taskUsageMap.delete(taskId);
    taskStartMap.delete(taskId);
    if (runningAgents.size === 0) setStatus("error", "prompt_error");
    console.error(`[remote] spawn 错误 (${taskId}):`, err);

    const canRetryByRouting = !agentOverride
      && routingAttempt < MAX_ROUTING_RETRIES
      && isRetryableAgentFailure(errorText);
    if (canRetryByRouting) {
      const triedAgents = Array.from(new Set<AgentType>([...routingTriedAgents, agentToUse]));
      const nextRoute = routeAgentForPrompt({
        prompt: payload,
        defaultAgent,
        source,
        triedAgents,
      });
      if (!triedAgents.includes(nextRoute.agent)) {
        const rerouteText = `[router] ${agentToUse} 执行失败，自动切换到 ${nextRoute.agent} 重试`;
        void sendEnvelope(MessageType.STREAM_CHUNK, `${rerouteText}\n`);
        if (!skipAck && promptId) {
          processedPromptIds.delete(promptId);
          relay.sendAck(promptId, deviceId, activeSessionId, "working", {
            reason: `reroute:${agentToUse}->${nextRoute.agent}`,
          });
        }
        if (runningAgents.size === 0) setStatus("running", "prompt_reroute");
        logEvent?.({
          type: "prompt_reroute",
          taskId,
          promptId,
          from: agentToUse,
          to: nextRoute.agent,
          error: errorText,
          attempt: routingAttempt + 1,
        });
        void handlePrompt({
          ...params,
          routingAttempt: routingAttempt + 1,
          routingTriedAgents: triedAgents,
        });
        return;
      }
    }

    if (agentToUse === "claude") {
      const fallback = readTranscriptFallback();
      if (fallback) {
        void sendEnvelope(MessageType.STREAM_CHUNK, `[fallback:transcript]\n${fallback}\n`);
        const finalText = streamedText || fallback;
        void sendEnvelope(MessageType.STREAM_END, JSON.stringify({ taskId, fallback: true, finalText }));
        if (runningAgents.size === 0) setStatus("idle", "prompt_fallback");
        if (!skipAck && promptId) {
          relay.sendAck(promptId, deviceId, activeSessionId, "ok", { reason: "fallback" });
        }
        if (source === "telegram") {
          void finalizeTelegramLive(finalText, "fallback");
        } else {
          sendTelegram(`执行异常，已回退 transcript 输出 (${taskId})`);
        }
        if (onTaskFinished) {
          void Promise.resolve(onTaskFinished({
            taskId,
            promptId,
            agent: agentToUse,
            prompt: payload,
            source: source ?? "unknown",
            success: false,
            changedFiles: Array.from(changedFiles),
            cwd: process.cwd(),
            error: "fallback:transcript",
          })).catch((reportError) => {
            console.warn("[remote] onTaskFinished failed:", reportError);
          });
        }
        logEvent?.({ type: "prompt_fallback", taskId, agent: agentToUse });
        processQueue(sendEnvelope);
        return;
      }
    }

    if (shouldRunShellFallback && shellFallbackPrompt) {
      void (async () => {
        try {
          const explicitConfirm = payload.trim().startsWith("!");
          const safety = evaluateCommandSafety(shellFallbackPrompt, {
            confirmed: explicitConfirm,
          });
          if (safety.decision === "forbidden" || safety.requiresConfirmation) {
            const reason = safety.decision === "forbidden"
              ? (safety.justification || "命令被安全策略拒绝执行。")
              : "命令需要确认。请在消息前加 `!` 后重试以确认执行。";
            const finalText = renderShellSafetyBlockedText(shellFallbackPrompt, reason);
            await sendEnvelope(MessageType.STREAM_CHUNK, `${finalText}\n`);
            await sendEnvelope(MessageType.STREAM_END, JSON.stringify({
              taskId,
              fallback: true,
              shellFallback: true,
              blockedBySafety: true,
              finalText,
            }));
            if (runningAgents.size === 0) setStatus("idle", "prompt_shell_blocked");
            if (!skipAck && promptId) {
              relay.sendAck(promptId, deviceId, activeSessionId, "terminal", {
                reason: `shell_blocked:${safety.decision}`,
              });
            }
            if (source === "telegram") {
              await finalizeTelegramLive(finalText, "error");
            } else {
              sendTelegram(`shell 已被安全策略拦截 (${taskId})`);
            }
            if (onTaskFinished) {
              await Promise.resolve(onTaskFinished({
                taskId,
                promptId,
                agent: agentToUse,
                prompt: payload,
                source: source ?? "unknown",
                success: false,
                changedFiles: Array.from(changedFiles),
                cwd: process.cwd(),
                error: `fallback:shell_blocked:${safety.decision}`,
              })).catch((reportError) => {
                console.warn("[remote] onTaskFinished failed:", reportError);
              });
            }
            logEvent?.({
              type: "prompt_shell_blocked",
              taskId,
              agent: agentToUse,
              decision: safety.decision,
              matchedRuleIds: safety.matchedRuleIds,
            });
            processQueue(sendEnvelope);
            return;
          }

          const result = await runTelegramShellCommand(
            shellFallbackPrompt,
            normalizedTelegramShellFallbackTimeoutMs,
          );
          const finalText = renderShellFallbackText(shellFallbackPrompt, result);
          await sendEnvelope(MessageType.STREAM_CHUNK, `${finalText}\n`);
          await sendEnvelope(MessageType.STREAM_END, JSON.stringify({
            taskId,
            fallback: true,
            shellFallback: true,
            finalText,
          }));
          if (runningAgents.size === 0) setStatus("idle", "prompt_shell_fallback");
          if (!skipAck && promptId) {
            relay.sendAck(promptId, deviceId, activeSessionId, "ok", { reason: "shell_fallback" });
          }
          if (source === "telegram") {
            await finalizeTelegramLive(finalText, "fallback");
          } else {
            sendTelegram(`执行异常，已回退 shell 输出 (${taskId})`);
          }
          if (onTaskFinished) {
            await Promise.resolve(onTaskFinished({
              taskId,
              promptId,
              agent: agentToUse,
              prompt: payload,
              source: source ?? "unknown",
              success: false,
              changedFiles: Array.from(changedFiles),
              cwd: process.cwd(),
              error: "fallback:shell",
            })).catch((reportError) => {
              console.warn("[remote] onTaskFinished failed:", reportError);
            });
          }
          logEvent?.({ type: "prompt_shell_fallback", taskId, agent: agentToUse });
          processQueue(sendEnvelope);
        } catch (shellError) {
          console.error(`[remote] shell fallback 错误 (${taskId}):`, shellError);
          if (!skipAck && promptId) {
            relay.sendAck(promptId, deviceId, activeSessionId, "terminal", { reason: String(shellError) });
          }
          if (source === "telegram") {
            await finalizeTelegramLive(String(shellError), "error");
          } else {
            sendTelegram(`执行错误 (${taskId}): ${shellError}`);
          }
          if (onTaskFinished) {
            await Promise.resolve(onTaskFinished({
              taskId,
              promptId,
              agent: agentToUse,
              prompt: payload,
              source: source ?? "unknown",
              success: false,
              changedFiles: Array.from(changedFiles),
              cwd: process.cwd(),
              error: String(shellError),
            })).catch((reportError) => {
              console.warn("[remote] onTaskFinished failed:", reportError);
            });
          }
          logEvent?.({ type: "prompt_error", taskId, agent: agentToUse, error: String(shellError) });
          processQueue(sendEnvelope);
        }
      })();
      return;
    }

    if (!skipAck && promptId) {
      relay.sendAck(promptId, deviceId, activeSessionId, "terminal", { reason: String(err) });
    }
    if (source === "telegram") {
      void finalizeTelegramLive(String(err), "error");
    } else {
      sendTelegram(`执行错误 (${taskId}): ${err}`);
    }
    if (onTaskFinished) {
      void Promise.resolve(onTaskFinished({
        taskId,
        promptId,
        agent: agentToUse,
        prompt: payload,
        source: source ?? "unknown",
        success: false,
        changedFiles: Array.from(changedFiles),
        cwd: process.cwd(),
        error: String(err),
      })).catch((reportError) => {
        console.warn("[remote] onTaskFinished failed:", reportError);
      });
    }
    logEvent?.({ type: "prompt_error", taskId, agent: agentToUse, error: String(err) });
    processQueue(sendEnvelope);
  });
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage, setTelegramMessageReaction } from "./telegram";
import { parseSlashCommand, resolveIngressNetworkMode, type IngressNetworkMode } from "@yuanio/shared";

interface TelegramMessage {
  chat?: { id?: number | string };
  message_id?: number;
  text?: string;
}

interface TelegramCallbackQuery {
  id?: string;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ParsedTelegramCommand {
  command: string;
  args: string[];
}

export type ParsedTelegramCallback =
  | {
    kind: "interaction_action";
    payload: {
      action: "continue" | "stop" | "approve" | "reject" | "retry" | "rollback";
      approvalId?: string;
      path?: string;
      prompt?: string;
      reason?: string;
    };
  }
  | { kind: "resume"; sessionId: string }
  | { kind: "skills_page"; page: number }
  | { kind: "approvals_page"; page: number }
  | { kind: "approvals_bulk"; approved: boolean; page: number }
  | { kind: "interactive"; input: string; behavior: "prompt" | "stop" }
  | { kind: "unknown"; raw: string };

export interface TelegramResumeOption {
  sessionId: string;
  label: string;
}

export interface TelegramSkillsPageResult {
  text: string;
  page: number;
  totalPages: number;
}

export interface TelegramApprovalsPageResult {
  text: string;
  page: number;
  totalPages: number;
  totalItems: number;
}

export interface TelegramWebhookHandlers {
  onPrompt: (prompt: string) => Promise<void>;
  onContinue: () => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => Promise<string>;
  onLoop: (prompt: string) => Promise<string>;
  onStatus: () => Promise<string>;
  onCwd: (path?: string) => Promise<string>;
  onProbe: () => Promise<string>;
  onMode: (mode?: string) => Promise<string>;
  onTasks: () => Promise<string>;
  onHistory: (args: string[]) => Promise<string>;
  onTask: (args: string[]) => Promise<string>;
  onApprovals: (args: string[]) => Promise<string | TelegramApprovalsPageResult>;
  onCheckpointList: () => Promise<string>;
  onCheckpointRestore: (checkpointId: string) => Promise<string>;
  onContextUsage: () => Promise<string>;
  onCompactContext: (instructions?: string) => Promise<string>;
  onRewind: (target: string, dryRun?: boolean) => Promise<string>;
  onMemory: (args: string[]) => Promise<string>;
  onAgents: (args: string[]) => Promise<string>;
  onStyle: (args: string[]) => Promise<string>;
  onPermissions: (args: string[]) => Promise<string>;
  onStatusline: (args: string[]) => Promise<string>;
  onSkill: (name: string, args: string[]) => Promise<string>;
  onSkills: (args: string[]) => Promise<string | TelegramSkillsPageResult>;
  onApprove: (approvalId?: string) => Promise<string>;
  onReject: (approvalId?: string) => Promise<string>;
  onInteractionAction: (payload: {
    action: "continue" | "stop" | "approve" | "reject" | "retry" | "rollback";
    approvalId?: string;
    path?: string;
    prompt?: string;
    reason?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  onResumeList: () => Promise<TelegramResumeOption[]>;
  onResume: (sessionId: string) => Promise<string>;
  onForwardCommand?: (rawText: string, command: string, args: string[]) => Promise<string | null>;
  onInteractiveInput?: (input: string, behavior: "prompt" | "stop") => Promise<string>;
}

export interface StartTelegramWebhookOptions {
  port: number;
  path?: string;
  secretToken?: string;
  allowedChatId: string;
  handlers: TelegramWebhookHandlers;
}

export interface TelegramWebhookServer {
  port: number;
  path: string;
  stop: () => Promise<void>;
}

const DEFAULT_PATH = "/telegram/webhook";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PROCESSED_UPDATE_IDS = 2048;
const MAX_PROCESSED_EVENT_KEYS = 4096;
const PROCESSED_EVENT_TTL_MS_RAW = Number(process.env.YUANIO_TELEGRAM_DEDUP_TTL_MS ?? 10 * 60 * 1000);
const PROCESSED_EVENT_TTL_MS = Number.isFinite(PROCESSED_EVENT_TTL_MS_RAW)
  ? Math.max(1_000, Math.floor(PROCESSED_EVENT_TTL_MS_RAW))
  : 10 * 60 * 1000;
const TELEGRAM_PROMPT_RECEIPT_ENABLED = process.env.YUANIO_TELEGRAM_PROMPT_RECEIPT === "1";
const TELEGRAM_REACTION_ENABLED = process.env.YUANIO_TELEGRAM_REACTION_ENABLED !== "0";
const TELEGRAM_REACTION_EMOJI = (process.env.YUANIO_TELEGRAM_REACTION_EMOJI || "✅").trim() || "✅";
const TELEGRAM_PROMPT_MIN_INTERVAL_MS_RAW = Number(process.env.YUANIO_TELEGRAM_PROMPT_MIN_INTERVAL_MS ?? 1200);
const TELEGRAM_PROMPT_MIN_INTERVAL_MS = Number.isFinite(TELEGRAM_PROMPT_MIN_INTERVAL_MS_RAW)
  ? Math.max(0, Math.floor(TELEGRAM_PROMPT_MIN_INTERVAL_MS_RAW))
  : 1200;
const TELEGRAM_LOOP_COOLDOWN_MS_RAW = Number(process.env.YUANIO_TELEGRAM_LOOP_COOLDOWN_MS ?? 15_000);
const TELEGRAM_LOOP_COOLDOWN_MS = Number.isFinite(TELEGRAM_LOOP_COOLDOWN_MS_RAW)
  ? Math.max(0, Math.floor(TELEGRAM_LOOP_COOLDOWN_MS_RAW))
  : 15_000;
const TELEGRAM_LOOP_DEDUP_WINDOW_MS_RAW = Number(process.env.YUANIO_TELEGRAM_LOOP_DEDUP_WINDOW_MS ?? 60_000);
const TELEGRAM_LOOP_DEDUP_WINDOW_MS = Number.isFinite(TELEGRAM_LOOP_DEDUP_WINDOW_MS_RAW)
  ? Math.max(1_000, Math.floor(TELEGRAM_LOOP_DEDUP_WINDOW_MS_RAW))
  : 60_000;
const TELEGRAM_CLEAR_DRAIN_MS_RAW = Number(process.env.YUANIO_TELEGRAM_CLEAR_DRAIN_MS ?? 8_000);
const TELEGRAM_CLEAR_DRAIN_MS = Number.isFinite(TELEGRAM_CLEAR_DRAIN_MS_RAW)
  ? Math.max(0, Math.floor(TELEGRAM_CLEAR_DRAIN_MS_RAW))
  : 8_000;
const TELEGRAM_INGRESS_NOTICE_INTERVAL_MS_RAW = Number(process.env.YUANIO_TELEGRAM_INGRESS_NOTICE_INTERVAL_MS ?? 3_000);
const TELEGRAM_INGRESS_NOTICE_INTERVAL_MS = Number.isFinite(TELEGRAM_INGRESS_NOTICE_INTERVAL_MS_RAW)
  ? Math.max(0, Math.floor(TELEGRAM_INGRESS_NOTICE_INTERVAL_MS_RAW))
  : 3_000;
const TELEGRAM_INGRESS_STATE_IDLE_MS = 15 * 60 * 1000;

const TELEGRAM_COMMAND_ALIASES: Record<string, string> = {
  continue_: "continue",
  reset: "clear",
  new: "clear",
  bug: "feedback",
  quit: "exit",
  settings: "config",
  app: "desktop",
  ios: "mobile",
  android: "mobile",
  rc: "remote-control",
  allowed_tools: "permissions",
  "allowed-tools": "permissions",
  output_style: "output-style",
  add_dir: "add-dir",
  extra_usage: "extra-usage",
  install_github_app: "install-github-app",
  install_slack_app: "install-slack-app",
  pr_comments: "pr-comments",
  privacy_settings: "privacy-settings",
  release_notes: "release-notes",
  reload_plugins: "reload-plugins",
  remote_control: "remote-control",
  remote_env: "remote-env",
  security_review: "security-review",
  terminal_setup: "terminal-setup",
};

export function normalizeTelegramCommand(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  return TELEGRAM_COMMAND_ALIASES[normalized] || normalized;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const parsed = parseSlashCommand(text, {
    prefix: "/",
    mentionSeparator: "@",
    normalizeCommand: (value) => value.toLowerCase(),
  });
  if (!parsed) return null;
  return {
    command: parsed.command,
    args: parsed.args,
  };
}

export function resolveTelegramIngressNetworkMode(
  env: Record<string, string | undefined> = process.env,
): IngressNetworkMode {
  return resolveIngressNetworkMode(
    env.YUANIO_TELEGRAM_NETWORK_MODE,
    env.YUANIO_INGRESS_NETWORK_MODE,
    env.YUANIO_NETWORK_MODE,
  );
}

export function parseTelegramCallback(data: string): ParsedTelegramCallback {
  if (data.startsWith("ia:")) {
    const raw = data.slice("ia:".length);
    const [actionRaw, valueRaw] = raw.split(":", 2);
    const action = (actionRaw || "").trim().toLowerCase();
    const value = (valueRaw || "").trim();
    if (
      action === "continue"
      || action === "stop"
      || action === "retry"
      || action === "rollback"
    ) {
      return {
        kind: "interaction_action",
        payload: {
          action,
          ...(action === "rollback" && value ? { path: value } : {}),
        },
      };
    }
    if ((action === "approve" || action === "reject") && value) {
      return {
        kind: "interaction_action",
        payload: {
          action,
          approvalId: value,
        },
      };
    }
  }

  if (data.startsWith("apr:y:")) {
    return {
      kind: "interaction_action",
      payload: {
        action: "approve",
        approvalId: data.slice("apr:y:".length),
      },
    };
  }
  if (data.startsWith("apr:n:")) {
    return {
      kind: "interaction_action",
      payload: {
        action: "reject",
        approvalId: data.slice("apr:n:".length),
      },
    };
  }
  if (data === "cmd:continue") {
    return { kind: "interaction_action", payload: { action: "continue" } };
  }
  if (data === "cmd:stop") {
    return { kind: "interaction_action", payload: { action: "stop" } };
  }
  if (data.startsWith("resume:")) {
    const sessionId = data.slice("resume:".length).trim();
    if (sessionId) return { kind: "resume", sessionId };
  }
  if (data.startsWith("skills:page:")) {
    const pageRaw = data.slice("skills:page:".length).trim();
    const page = Number(pageRaw);
    if (Number.isFinite(page) && page > 0) {
      return { kind: "skills_page", page: Math.floor(page) };
    }
  }
  if (data.startsWith("approvals:page:")) {
    const pageRaw = data.slice("approvals:page:".length).trim();
    const page = Number(pageRaw);
    if (Number.isFinite(page) && page > 0) {
      return { kind: "approvals_page", page: Math.floor(page) };
    }
  }
  if (data.startsWith("approvals:bulk:")) {
    const raw = data.slice("approvals:bulk:".length);
    const [actionRaw, pageRaw] = raw.split(":");
    const action = (actionRaw || "").trim().toLowerCase();
    const page = Number((pageRaw || "").trim());
    if ((action === "y" || action === "n") && Number.isFinite(page) && page > 0) {
      return {
        kind: "approvals_bulk",
        approved: action === "y",
        page: Math.floor(page),
      };
    }
  }
  if (data.startsWith("in:")) {
    const action = data.slice("in:".length).trim();
    if (action === "y") return { kind: "interactive", input: "y", behavior: "prompt" };
    if (action === "n") return { kind: "interactive", input: "n", behavior: "prompt" };
    if (action === "enter") return { kind: "interactive", input: "continue", behavior: "prompt" };
    if (action === "esc") return { kind: "interactive", input: "", behavior: "stop" };
    if (action.startsWith("opt:")) {
      const value = action.slice("opt:".length).trim();
      if (value) return { kind: "interactive", input: value, behavior: "prompt" };
    }
    if (action.startsWith("text:")) {
      const encoded = action.slice("text:".length);
      if (encoded) {
        try {
          const decoded = decodeURIComponent(encoded);
          if (decoded) return { kind: "interactive", input: decoded, behavior: "prompt" };
        } catch {
          // ignore malformed encoded payload
        }
      }
    }
  }
  return { kind: "unknown", raw: data };
}

export function shouldSkipTelegramUpdate(
  updateId: number | undefined,
  processedUpdateIds: Map<number, number>,
  maxProcessedUpdates = MAX_PROCESSED_UPDATE_IDS,
): boolean {
  if (!Number.isFinite(updateId)) return false;
  const normalized = Math.floor(updateId as number);
  if (processedUpdateIds.has(normalized)) return true;
  processedUpdateIds.set(normalized, Date.now());
  if (processedUpdateIds.size > maxProcessedUpdates) {
    const oldest = processedUpdateIds.keys().next().value as number | undefined;
    if (typeof oldest === "number") processedUpdateIds.delete(oldest);
  }
  return false;
}

export function buildTelegramDedupKey(update: TelegramUpdate): string | null {
  const cbId = update.callback_query?.id;
  if (cbId) return `cb:${cbId}`;
  const chatId = update.message?.chat?.id;
  const messageId = update.message?.message_id;
  if (chatId !== undefined && chatId !== null && messageId !== undefined && messageId !== null) {
    return `msg:${String(chatId)}:${String(messageId)}`;
  }
  return null;
}

function shouldSkipTelegramEventKey(
  dedupKey: string | null,
  processedEventKeys: Map<string, number>,
  nowMs = Date.now(),
  ttlMs = PROCESSED_EVENT_TTL_MS,
  maxProcessedEventKeys = MAX_PROCESSED_EVENT_KEYS,
): boolean {
  if (!dedupKey) return false;

  // 先清理过期项，避免长期运行内存增长。
  for (const [key, ts] of processedEventKeys) {
    if (nowMs - ts > ttlMs) {
      processedEventKeys.delete(key);
      continue;
    }
    break;
  }

  if (processedEventKeys.has(dedupKey)) return true;
  processedEventKeys.set(dedupKey, nowMs);
  if (processedEventKeys.size > maxProcessedEventKeys) {
    const oldest = processedEventKeys.keys().next().value as string | undefined;
    if (oldest) processedEventKeys.delete(oldest);
  }
  return false;
}

function getRequestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return req.url || "/";
  }
}

function extractChatId(update: TelegramUpdate): string | null {
  const cbId = update.callback_query?.message?.chat?.id;
  if (cbId !== undefined && cbId !== null) return String(cbId);
  const msgId = update.message?.chat?.id;
  if (msgId !== undefined && msgId !== null) return String(msgId);
  return null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("payload too large");
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function respond(res: ServerResponse, code: number, text = "ok"): void {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function buildHelpText(): string {
  return [
    "可用命令（本地增强）：",
    "/status - 查看当前状态",
    "/continue_ - 发送 continue",
    "/continue [session] - 恢复会话（Claude /resume 别名）",
    "/stop - 中止当前任务",
    "/clear - 中止任务并清空队列",
    "/loop <prompt> - 以循环模式执行任务（最多 5 轮）",
    "/mode [plan|act] - 切换执行模式",
    "/plan - 快速切到 plan",
    "/act - 快速切到 act",
    "/tasks - 查看并发任务面板",
    "/history [n] - 查看最近任务历史",
    "/task <taskId> - 查看任务详情与输出",
    "/approvals - 查看待审批列表（支持分页/批量）",
    "/checkpoint list - 查看 checkpoint 时间线",
    "/checkpoint restore <id> - 回滚到 checkpoint",
    "/context - 查看上下文占用",
    "/compact [instructions] - 触发上下文压缩",
    "/rewind <checkpoint|promptId> [--dry-run] - 回滚预览/执行",
    "/memory status|on|off|add <note> - 记忆中心",
    "/agents [list] - 查看子代理",
    "/style [list|set <id>] - 输出风格",
    "/permissions [show] - 查看权限规则",
    "/statusline [show|on|off|set <cmd>] - 状态栏",
    "/skill <name> [args] - 调用技能/子代理",
    "/skills - 列出技能",
    "/skills install <source> [--scope project|user] - 准备安装并返回候选",
    "/skills commit <installId> <all|name|id|index...> [--skip|--overwrite|--rename] - 安装所选",
    "/skills status <installId> - 查看安装会话状态",
    "/skills cancel <installId> - 取消并清理安装会话",
    "/cwd [path] - 查看或切换工作目录",
    "/probe - 前台探活与状态快照",
    "/resume - 选择并恢复历史会话",
    "/approve [id] - 批准审批（默认最近一条）",
    "/reject [id] - 拒绝审批（默认最近一条）",
    "",
    "Claude Code 内建命令（透传执行，按策略放行）：",
    "/add-dir /agents /chrome /clear /compact /config /context /copy /cost /desktop",
    "/diff /doctor /exit /export /extra-usage /fast /feedback /fork /help /hooks",
    "/ide /init /insights /install-github-app /install-slack-app /keybindings",
    "/login /logout /mcp /memory /mobile /model /output-style /passes /permissions",
    "/plan /plugin /pr-comments /privacy-settings /release-notes /remote-control",
    "/reload-plugins /remote-env /rename /resume /review /rewind /sandbox /security-review /skills",
    "/stats /status /statusline /stickers /tasks /terminal-setup /theme /upgrade /usage /vim",
    "别名示例: /settings /allowed_tools /output_style /add_dir /remote_control /terminal_setup /reload_plugins /bug /quit",
    "",
    "未识别的 /xxx 会尝试透传给 Agent（可被策略拦截）",
    "普通文本会作为 prompt 发送",
  ].join("\n");
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clampTelegramText(text: string, max = 3600): string {
  if (text.length <= max) return text;
  const marker = "\n...(truncated)";
  const size = Math.max(0, max - marker.length);
  return `${text.slice(0, size)}${marker}`;
}

function formatInlineWithCommandCode(text: string): string {
  const escaped = escapeTelegramHtml(text);
  return escaped.replace(/(^|\s)(\/[a-zA-Z0-9_.:-]+)/g, "$1<code>$2</code>");
}

function formatSkillsReplyHtml(raw: string): string {
  const safeRaw = clampTelegramText(raw, 3600);
  const lines = safeRaw.split(/\r?\n/);
  const out: string[] = [];
  let seenSkillItem = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }

    if (/^Skills$/i.test(trimmed)) {
      out.push("<b>Skills</b>");
      continue;
    }
    if (/^提示:\s*/.test(trimmed)) {
      out.push(`<b>提示</b>: ${formatInlineWithCommandCode(trimmed.replace(/^提示:\s*/, ""))}`);
      continue;
    }

    const listItem = trimmed.match(/^- \/([^\s]+)\s+\(([^)]+)\)(?::\s*(.+))?$/);
    if (listItem) {
      if (seenSkillItem) {
        out.push("");
      }
      const name = escapeTelegramHtml(listItem[1] || "unknown");
      const scope = escapeTelegramHtml(listItem[2] || "project");
      const desc = listItem[3] ? escapeTelegramHtml(listItem[3]) : "";
      out.push(`• <code>/${name}</code> <i>(${scope})</i>${desc ? `\n  ${desc}` : ""}`);
      seenSkillItem = true;
      continue;
    }

    const candidate = trimmed.match(/^(\d+)\.\s+\[(ok|invalid)\]\s+(.+?)\s+-\s+(.+)$/);
    if (candidate) {
      const idx = escapeTelegramHtml(candidate[1] || "");
      const state = (candidate[2] || "").toLowerCase() === "ok" ? "ok" : "invalid";
      const name = escapeTelegramHtml(candidate[3] || "unknown");
      const desc = escapeTelegramHtml(candidate[4] || "");
      out.push(`<b>${idx}.</b> [<code>${state}</code>] <code>${name}</code>${desc ? `\n  ${desc}` : ""}`);
      continue;
    }

    if (/^path=/.test(trimmed)) {
      out.push(`  <code>${escapeTelegramHtml(trimmed)}</code>`);
      continue;
    }

    const installed = trimmed.match(/^\+\s+installed:\s+(.+?)\s+->\s+(.+)$/);
    if (installed) {
      out.push(`+ installed: <code>${escapeTelegramHtml(installed[1] || "unknown")}</code>\n  <code>${escapeTelegramHtml(installed[2] || "")}</code>`);
      continue;
    }

    const skipped = trimmed.match(/^-\s+skipped:\s+(.+?)\s+\((.+)\)$/);
    if (skipped) {
      out.push(`- skipped: <code>${escapeTelegramHtml(skipped[1] || "unknown")}</code> (${escapeTelegramHtml(skipped[2] || "")})`);
      continue;
    }

    const failed = trimmed.match(/^!\s+failed:\s+(.+?)\s+\((.+)\)$/);
    if (failed) {
      out.push(`! failed: <code>${escapeTelegramHtml(failed[1] || "unknown")}</code> (${escapeTelegramHtml(failed[2] || "")})`);
      continue;
    }

    out.push(formatInlineWithCommandCode(trimmed));
  }

  return out.join("\n");
}

function normalizeSkillsResponse(
  result: string | TelegramSkillsPageResult,
): TelegramSkillsPageResult {
  if (typeof result === "string") {
    return {
      text: result,
      page: 1,
      totalPages: 1,
    };
  }
  const page = Number.isFinite(result.page) ? Math.max(1, Math.floor(result.page)) : 1;
  const totalPages = Number.isFinite(result.totalPages) ? Math.max(1, Math.floor(result.totalPages)) : 1;
  return {
    text: result.text || "",
    page: Math.min(page, totalPages),
    totalPages,
  };
}

function buildSkillsPaginationMarkup(page: number, totalPages: number): Record<string, unknown> | undefined {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return undefined;
  const safePage = Math.min(Math.max(1, Math.floor(page)), Math.floor(totalPages));
  const prevPage = Math.max(1, safePage - 1);
  const nextPage = Math.min(totalPages, safePage + 1);
  return {
    inline_keyboard: [[
      { text: "首页", callback_data: "skills:page:1" },
      { text: "上一页", callback_data: `skills:page:${prevPage}` },
      { text: `${safePage}/${totalPages}`, callback_data: `skills:page:${safePage}` },
      { text: "下一页", callback_data: `skills:page:${nextPage}` },
      { text: "末页", callback_data: `skills:page:${totalPages}` },
    ]],
  };
}

function formatApprovalsReplyHtml(raw: string): string {
  const safeRaw = clampTelegramText(raw, 3600);
  const lines = safeRaw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (/^待审批列表/.test(trimmed)) {
      out.push(`<b>${escapeTelegramHtml(trimmed)}</b>`);
      continue;
    }
    out.push(formatInlineWithCommandCode(trimmed));
  }
  return out.join("\n");
}

function normalizeApprovalsResponse(
  result: string | TelegramApprovalsPageResult,
): TelegramApprovalsPageResult {
  if (typeof result === "string") {
    return {
      text: result,
      page: 1,
      totalPages: 1,
      totalItems: 0,
    };
  }
  const page = Number.isFinite(result.page) ? Math.max(1, Math.floor(result.page)) : 1;
  const totalPages = Number.isFinite(result.totalPages) ? Math.max(1, Math.floor(result.totalPages)) : 1;
  const totalItems = Number.isFinite(result.totalItems) ? Math.max(0, Math.floor(result.totalItems)) : 0;
  return {
    text: result.text || "",
    page: Math.min(page, totalPages),
    totalPages,
    totalItems,
  };
}

function buildApprovalsPaginationMarkup(
  page: number,
  totalPages: number,
  totalItems: number,
): Record<string, unknown> | undefined {
  if (!Number.isFinite(totalItems) || totalItems <= 0) return undefined;
  const safeTotalPages = Number.isFinite(totalPages) ? Math.max(1, Math.floor(totalPages)) : 1;
  const safePage = Math.min(Math.max(1, Math.floor(page)), safeTotalPages);
  const prevPage = Math.max(1, safePage - 1);
  const nextPage = Math.min(safeTotalPages, safePage + 1);
  return {
    inline_keyboard: [
      [
        { text: "首页", callback_data: "approvals:page:1" },
        { text: "上一页", callback_data: `approvals:page:${prevPage}` },
        { text: `${safePage}/${safeTotalPages}`, callback_data: `approvals:page:${safePage}` },
        { text: "下一页", callback_data: `approvals:page:${nextPage}` },
        { text: "末页", callback_data: `approvals:page:${safeTotalPages}` },
      ],
      [
        { text: "本页全批", callback_data: `approvals:bulk:y:${safePage}` },
        { text: "本页全拒", callback_data: `approvals:bulk:n:${safePage}` },
      ],
    ],
  };
}

interface TelegramIngressState {
  lastSeenAtMs: number;
  dropUntilMs: number;
  lastPromptAtMs: number;
  lastPromptFingerprint: string;
  lastLoopAtMs: number;
  lastLoopFingerprint: string;
  lastNoticeAtMs: number;
}

function normalizeTelegramFingerprint(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function getIngressState(chatId: string, ingressStates: Map<string, TelegramIngressState>): TelegramIngressState {
  const existing = ingressStates.get(chatId);
  if (existing) return existing;
  const state: TelegramIngressState = {
    lastSeenAtMs: 0,
    dropUntilMs: 0,
    lastPromptAtMs: 0,
    lastPromptFingerprint: "",
    lastLoopAtMs: 0,
    lastLoopFingerprint: "",
    lastNoticeAtMs: 0,
  };
  ingressStates.set(chatId, state);
  return state;
}

function pruneIngressStates(ingressStates: Map<string, TelegramIngressState>, nowMs = Date.now()): void {
  for (const [chatId, state] of ingressStates) {
    if (nowMs - state.lastSeenAtMs > TELEGRAM_INGRESS_STATE_IDLE_MS) {
      ingressStates.delete(chatId);
    }
  }
}

async function maybeSendIngressNotice(
  chatId: string,
  state: TelegramIngressState,
  nowMs: number,
  text: string,
): Promise<void> {
  if (TELEGRAM_INGRESS_NOTICE_INTERVAL_MS > 0 && nowMs - state.lastNoticeAtMs < TELEGRAM_INGRESS_NOTICE_INTERVAL_MS) {
    return;
  }
  state.lastNoticeAtMs = nowMs;
  await sendTelegramMessage({ chatId, text, disableNotification: true });
}

function isDrainExemptCommand(command: string): boolean {
  return command === "start"
    || command === "help"
    || command === "status"
    || command === "stop"
    || command === "clear";
}

async function handleMessage(
  chatId: string,
  msg: TelegramMessage,
  handlers: TelegramWebhookHandlers,
  ingressStates: Map<string, TelegramIngressState>,
): Promise<void> {
  const text = (msg.text || "").trim();
  if (!text) return;
  const nowMs = Date.now();
  const ingress = getIngressState(chatId, ingressStates);
  ingress.lastSeenAtMs = nowMs;
  if (TELEGRAM_REACTION_ENABLED && typeof msg.message_id === "number") {
    void setTelegramMessageReaction(chatId, msg.message_id, TELEGRAM_REACTION_EMOJI);
  }

  const cmd = parseTelegramCommand(text);
  if (!cmd) {
    if (ingress.dropUntilMs > nowMs) {
      await maybeSendIngressNotice(
        chatId,
        ingress,
        nowMs,
        `已执行 /clear，正在排空积压消息，请稍后再发 prompt（约 ${Math.ceil((ingress.dropUntilMs - nowMs) / 1000)}s）`,
      );
      return;
    }
    const promptFingerprint = normalizeTelegramFingerprint(text);
    if (
      TELEGRAM_PROMPT_MIN_INTERVAL_MS > 0
      && promptFingerprint
      && promptFingerprint === ingress.lastPromptFingerprint
      && (nowMs - ingress.lastPromptAtMs) < TELEGRAM_PROMPT_MIN_INTERVAL_MS
    ) {
      await maybeSendIngressNotice(chatId, ingress, nowMs, "检测到重复 prompt，已自动忽略");
      return;
    }
    ingress.lastPromptFingerprint = promptFingerprint;
    ingress.lastPromptAtMs = nowMs;
    await handlers.onPrompt(text);
    if (TELEGRAM_PROMPT_RECEIPT_ENABLED) {
      await sendTelegramMessage({
        chatId,
        text: `已发送 prompt（${Math.min(text.length, 200)} chars）`,
        disableNotification: true,
      });
    }
    return;
  }
  const command = normalizeTelegramCommand(cmd.command);
  if (ingress.dropUntilMs > nowMs && !isDrainExemptCommand(command)) {
    await maybeSendIngressNotice(
      chatId,
      ingress,
      nowMs,
      `正在排空积压消息，请稍后重试（约 ${Math.ceil((ingress.dropUntilMs - nowMs) / 1000)}s）`,
    );
    return;
  }

  switch (command) {
    case "start":
    case "help":
      await sendTelegramMessage({ chatId, text: buildHelpText() });
      return;
    case "status": {
      const status = await handlers.onStatus();
      await sendTelegramMessage({ chatId, text: status });
      return;
    }
    case "continue":
      // 对齐 Claude 官方：/continue 作为 /resume 别名；本地 continue 使用 /continue_
      if (cmd.command === "continue_") {
        await handlers.onContinue();
        await sendTelegramMessage({ chatId, text: "已发送 continue", disableNotification: true });
        return;
      }
      if (cmd.args[0]) {
        const result = await handlers.onResume(cmd.args[0]);
        await sendTelegramMessage({ chatId, text: result, disableNotification: true });
        return;
      }
      {
        const options = await handlers.onResumeList();
        if (options.length === 0) {
          await sendTelegramMessage({ chatId, text: "暂无可恢复会话", disableNotification: true });
          return;
        }
        const keyboard = [
          [{ text: "继续最近会话", callback_data: "ia:continue" }],
          ...options.slice(0, 8).map((item) => ([{
            text: item.label.length > 48 ? `${item.label.slice(0, 46)}..` : item.label,
            callback_data: `resume:${item.sessionId}`,
          }])),
        ];
        await sendTelegramMessage({
          chatId,
          text: "选择要恢复的会话：",
          replyMarkup: { inline_keyboard: keyboard },
        });
      }
      return;
    case "stop":
      await handlers.onStop();
      await sendTelegramMessage({ chatId, text: "已发送中止请求", disableNotification: true });
      return;
    case "clear": {
      const result = await handlers.onClear();
      ingress.dropUntilMs = nowMs + TELEGRAM_CLEAR_DRAIN_MS;
      ingress.lastPromptAtMs = 0;
      ingress.lastPromptFingerprint = "";
      ingress.lastLoopAtMs = 0;
      ingress.lastLoopFingerprint = "";
      const drainSuffix = TELEGRAM_CLEAR_DRAIN_MS > 0
        ? `\n(已进入 ${Math.ceil(TELEGRAM_CLEAR_DRAIN_MS / 1000)}s 排空窗口)`
        : "";
      await sendTelegramMessage({ chatId, text: `${result}${drainSuffix}`, disableNotification: true });
      return;
    }
    case "loop": {
      const loopPrompt = cmd.args.join(" ").trim();
      if (!loopPrompt) {
        await sendTelegramMessage({ chatId, text: "用法: /loop <prompt>", disableNotification: true });
        return;
      }
      const loopFingerprint = normalizeTelegramFingerprint(loopPrompt);
      if (
        loopFingerprint
        && loopFingerprint === ingress.lastLoopFingerprint
        && (nowMs - ingress.lastLoopAtMs) < TELEGRAM_LOOP_DEDUP_WINDOW_MS
      ) {
        await maybeSendIngressNotice(chatId, ingress, nowMs, "检测到重复 /loop，已忽略");
        return;
      }
      if (TELEGRAM_LOOP_COOLDOWN_MS > 0 && (nowMs - ingress.lastLoopAtMs) < TELEGRAM_LOOP_COOLDOWN_MS) {
        const leftSec = Math.ceil((TELEGRAM_LOOP_COOLDOWN_MS - (nowMs - ingress.lastLoopAtMs)) / 1000);
        await maybeSendIngressNotice(chatId, ingress, nowMs, `循环任务过于频繁，请 ${Math.max(1, leftSec)}s 后重试`);
        return;
      }
      ingress.lastLoopAtMs = nowMs;
      ingress.lastLoopFingerprint = loopFingerprint;
      const result = await handlers.onLoop(loopPrompt);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "cwd": {
      const path = cmd.args.join(" ").trim();
      const result = await handlers.onCwd(path || undefined);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "probe": {
      const result = await handlers.onProbe();
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "mode": {
      const result = await handlers.onMode(cmd.args[0]);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "plan": {
      const result = await handlers.onMode("plan");
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "act": {
      const result = await handlers.onMode("act");
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "tasks": {
      const result = await handlers.onTasks();
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "history": {
      const result = await handlers.onHistory(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "task": {
      const result = await handlers.onTask(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "approvals": {
      const result = normalizeApprovalsResponse(await handlers.onApprovals(cmd.args));
      await sendTelegramMessage({
        chatId,
        text: formatApprovalsReplyHtml(result.text),
        parseMode: "HTML",
        replyMarkup: buildApprovalsPaginationMarkup(result.page, result.totalPages, result.totalItems),
        disableNotification: true,
      });
      return;
    }
    case "checkpoint": {
      const action = (cmd.args[0] || "list").toLowerCase();
      if (action === "list") {
        const result = await handlers.onCheckpointList();
        await sendTelegramMessage({ chatId, text: result, disableNotification: true });
        return;
      }
      if (action === "restore") {
        const checkpointId = cmd.args[1];
        if (!checkpointId) {
          await sendTelegramMessage({ chatId, text: "用法: /checkpoint restore <id>", disableNotification: true });
          return;
        }
        const result = await handlers.onCheckpointRestore(checkpointId);
        await sendTelegramMessage({ chatId, text: result, disableNotification: true });
        return;
      }
      // 对齐 Claude 官方：/checkpoint 是 /rewind 别名。
      if (handlers.onForwardCommand) {
        const forwardedText = text.replace(new RegExp(`^/${cmd.command}(?=\\s|$)`, "i"), "/rewind");
        const forwarded = await handlers.onForwardCommand(forwardedText, "rewind", cmd.args);
        if (forwarded) {
          await sendTelegramMessage({ chatId, text: forwarded, disableNotification: true });
          return;
        }
      }
      await sendTelegramMessage({
        chatId,
        text: "用法: /checkpoint list | /checkpoint restore <id>",
        disableNotification: true,
      });
      return;
    }
    case "context": {
      const result = await handlers.onContextUsage();
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "compact": {
      const instructions = cmd.args.join(" ").trim();
      const result = await handlers.onCompactContext(instructions || undefined);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "rewind": {
      const target = (cmd.args[0] || "").trim();
      if (!target) {
        await sendTelegramMessage({ chatId, text: "用法: /rewind <checkpoint|promptId> [--dry-run]", disableNotification: true });
        return;
      }
      const dryRun = cmd.args.some((arg) => arg === "--dry-run" || arg === "dry-run");
      const result = await handlers.onRewind(target, dryRun);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "memory": {
      const result = await handlers.onMemory(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "agents": {
      const result = await handlers.onAgents(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "style": {
      const result = await handlers.onStyle(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "output-style": {
      const result = await handlers.onStyle(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "permissions": {
      const result = await handlers.onPermissions(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "statusline": {
      const result = await handlers.onStatusline(cmd.args);
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "skill": {
      const name = (cmd.args[0] || "").trim();
      if (!name) {
        await sendTelegramMessage({ chatId, text: "用法: /skill <name> [args]", disableNotification: true });
        return;
      }
      const result = await handlers.onSkill(name, cmd.args.slice(1));
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
      return;
    }
    case "skills": {
      const result = normalizeSkillsResponse(await handlers.onSkills(cmd.args));
      await sendTelegramMessage({
        chatId,
        text: formatSkillsReplyHtml(result.text),
        parseMode: "HTML",
        replyMarkup: buildSkillsPaginationMarkup(result.page, result.totalPages),
        disableNotification: true,
      });
      return;
    }
    case "approve": {
      const message = await handlers.onApprove(cmd.args[0]);
      await sendTelegramMessage({ chatId, text: message, disableNotification: true });
      return;
    }
    case "reject": {
      const message = await handlers.onReject(cmd.args[0]);
      await sendTelegramMessage({ chatId, text: message, disableNotification: true });
      return;
    }
    case "resume": {
      if (cmd.args[0]) {
        const result = await handlers.onResume(cmd.args[0]);
        await sendTelegramMessage({ chatId, text: result, disableNotification: true });
        return;
      }
      const options = await handlers.onResumeList();
      if (options.length === 0) {
        await sendTelegramMessage({ chatId, text: "暂无可恢复会话", disableNotification: true });
        return;
      }
      const keyboard = [
        [{ text: "继续最近会话", callback_data: "ia:continue" }],
        ...options.slice(0, 8).map((item) => ([{
          text: item.label.length > 48 ? `${item.label.slice(0, 46)}..` : item.label,
          callback_data: `resume:${item.sessionId}`,
        }])),
      ];
      await sendTelegramMessage({
        chatId,
        text: "选择要恢复的会话：",
        replyMarkup: { inline_keyboard: keyboard },
      });
      return;
    }
    default:
      if (handlers.onForwardCommand) {
        const normalizedCommand = command;
        const normalizedText = normalizedCommand === cmd.command
          ? text
          : text.replace(new RegExp(`^/${cmd.command}(?=\\s|$)`, "i"), `/${normalizedCommand}`);
        const forwarded = await handlers.onForwardCommand(normalizedText, normalizedCommand, cmd.args);
        if (forwarded) {
          await sendTelegramMessage({ chatId, text: forwarded, disableNotification: true });
          return;
        }
      }
      await sendTelegramMessage({
        chatId,
        text: `命令 /${cmd.command} 未放行，发送 /help 查看支持列表`,
        disableNotification: true,
      });
  }
}

async function handleCallback(chatId: string, cb: TelegramCallbackQuery, handlers: TelegramWebhookHandlers): Promise<void> {
  const callbackId = cb.id || "";
  const data = cb.data || "";

  const parsed = parseTelegramCallback(data);
  if (parsed.kind === "interaction_action") {
    const result = await handlers.onInteractionAction(parsed.payload);
    if (callbackId) {
      await answerTelegramCallback(callbackId, result.message.slice(0, 180));
    } else {
      await sendTelegramMessage({ chatId, text: result.message, disableNotification: true });
    }
    return;
  }

  if (parsed.kind === "resume") {
    const result = await handlers.onResume(parsed.sessionId);
    if (callbackId) {
      await answerTelegramCallback(callbackId, result.slice(0, 180));
    } else {
      await sendTelegramMessage({ chatId, text: result, disableNotification: true });
    }
    return;
  }

  if (parsed.kind === "skills_page") {
    const result = normalizeSkillsResponse(await handlers.onSkills(["page", String(parsed.page)]));
    const htmlText = formatSkillsReplyHtml(result.text);
    const replyMarkup = buildSkillsPaginationMarkup(result.page, result.totalPages);
    const messageId = cb.message?.message_id;
    let edited = false;
    if (typeof messageId === "number") {
      edited = await editTelegramMessage(chatId, messageId, htmlText, replyMarkup, "HTML");
    }
    if (!edited) {
      await sendTelegramMessage({
        chatId,
        text: htmlText,
        parseMode: "HTML",
        replyMarkup,
        disableNotification: true,
      });
    }
    if (callbackId) {
      await answerTelegramCallback(callbackId, `第 ${result.page}/${result.totalPages} 页`);
    }
    return;
  }

  if (parsed.kind === "approvals_page") {
    const result = normalizeApprovalsResponse(await handlers.onApprovals(["page", String(parsed.page)]));
    const htmlText = formatApprovalsReplyHtml(result.text);
    const replyMarkup = buildApprovalsPaginationMarkup(result.page, result.totalPages, result.totalItems);
    const messageId = cb.message?.message_id;
    let edited = false;
    if (typeof messageId === "number") {
      edited = await editTelegramMessage(chatId, messageId, htmlText, replyMarkup, "HTML");
    }
    if (!edited) {
      await sendTelegramMessage({
        chatId,
        text: htmlText,
        parseMode: "HTML",
        replyMarkup,
        disableNotification: true,
      });
    }
    if (callbackId) {
      await answerTelegramCallback(callbackId, `审批第 ${result.page}/${result.totalPages} 页`);
    }
    return;
  }

  if (parsed.kind === "approvals_bulk") {
    const action = parsed.approved ? "approve" : "reject";
    const result = normalizeApprovalsResponse(await handlers.onApprovals(["bulk", action, String(parsed.page)]));
    const htmlText = formatApprovalsReplyHtml(result.text);
    const replyMarkup = buildApprovalsPaginationMarkup(result.page, result.totalPages, result.totalItems);
    const messageId = cb.message?.message_id;
    let edited = false;
    if (typeof messageId === "number") {
      edited = await editTelegramMessage(chatId, messageId, htmlText, replyMarkup, "HTML");
    }
    if (!edited) {
      await sendTelegramMessage({
        chatId,
        text: htmlText,
        parseMode: "HTML",
        replyMarkup,
        disableNotification: true,
      });
    }
    if (callbackId) {
      await answerTelegramCallback(callbackId, parsed.approved ? "已批量批准" : "已批量拒绝");
    }
    return;
  }

  if (parsed.kind === "interactive") {
    if (parsed.behavior === "stop") {
      await handlers.onStop();
      if (callbackId) await answerTelegramCallback(callbackId, "已发送中止请求");
      if (!callbackId) await sendTelegramMessage({ chatId, text: "已发送中止请求", disableNotification: true });
      return;
    }
    const feedback = handlers.onInteractiveInput
      ? await handlers.onInteractiveInput(parsed.input, parsed.behavior)
      : null;
    if (callbackId) {
      await answerTelegramCallback(callbackId, (feedback || `已发送输入: ${parsed.input}`).slice(0, 180));
    } else {
      await sendTelegramMessage({
        chatId,
        text: feedback || `已发送输入: ${parsed.input}`,
        disableNotification: true,
      });
    }
    return;
  }

  if (callbackId) {
    await answerTelegramCallback(callbackId, "未知操作");
  } else {
    await sendTelegramMessage({ chatId, text: "未知操作", disableNotification: true });
  }
}

export function startTelegramWebhookServer(options: StartTelegramWebhookOptions): Promise<TelegramWebhookServer> {
  const webhookPath = options.path || DEFAULT_PATH;
  const processedUpdateIds = new Map<number, number>();
  const processedEventKeys = new Map<string, number>();
  const ingressStates = new Map<string, TelegramIngressState>();
  const ingressNetworkMode = resolveTelegramIngressNetworkMode();
  if (ingressNetworkMode === "lan") {
    console.warn("[telegram-webhook] 当前网络模式为 LAN；仅本地联调可用，Telegram 公网交互需切换 cloudflare/public。");
  }

  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      if (req.method !== "POST" || getRequestPath(req) !== webhookPath) {
        respond(res, 404, "not found");
        return;
      }

      const secret = options.secretToken;
      if (secret) {
        const got = req.headers["x-telegram-bot-api-secret-token"];
        const header = Array.isArray(got) ? got[0] : got;
        if (!header || header !== secret) {
          respond(res, 401, "unauthorized");
          return;
        }
      }

      try {
        const raw = await readBody(req);
        const update = JSON.parse(raw) as TelegramUpdate;
        pruneIngressStates(ingressStates);
        const dedupKey = buildTelegramDedupKey(update);
        if (shouldSkipTelegramEventKey(dedupKey, processedEventKeys)) {
          respond(res, 200, "ok");
          return;
        }
        const chatId = extractChatId(update);
        if (!chatId || chatId !== options.allowedChatId) {
          respond(res, 200, "ignored");
          return;
        }
        if (shouldSkipTelegramUpdate(update.update_id, processedUpdateIds)) {
          respond(res, 200, "ok");
          return;
        }

        if (update.callback_query) {
          await handleCallback(chatId, update.callback_query, options.handlers);
        } else if (update.message) {
          await handleMessage(chatId, update.message, options.handlers, ingressStates);
        }
        respond(res, 200, "ok");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[telegram-webhook] failed: ${msg}`);
        respond(res, 200, "ok");
      }
    });

    server.listen(options.port, "0.0.0.0", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("无法获取 telegram webhook 端口"));
        return;
      }
      resolve({
        port: addr.port,
        path: webhookPath,
        stop: () => new Promise<void>((resolveStop) => server.close(() => resolveStop())),
      });
    });

    server.on("error", reject);
  });
}

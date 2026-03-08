import { loadKeys, type StoredKeys } from "./keystore";

interface TelegramAuth {
  botToken: string;
  chatId: string;
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramCommandItem {
  command: string;
  description: string;
}

export interface TelegramSendMessageOptions {
  text: string;
  chatId?: string;
  parseMode?: "Markdown" | "HTML";
  replyMarkup?: Record<string, unknown>;
  disableNotification?: boolean;
}

export interface TelegramWebhookOptions {
  url: string;
  secretToken?: string;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
  maxConnections?: number;
  ipAddress?: string;
}

export interface TelegramWebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}

const telegramMethodBackoffUntil = new Map<string, number>();
const telegramMethodWarnAt = new Map<string, number>();
const TELEGRAM_WARN_COOLDOWN_MS = 10_000;

function resolveAuth(keysOverride?: StoredKeys): TelegramAuth | null {
  const keys = keysOverride || loadKeys();
  if (!keys?.telegramBotToken || !keys?.telegramChatId) return null;
  return {
    botToken: keys.telegramBotToken,
    chatId: String(keys.telegramChatId),
  };
}

function resolveTelegramApiBase(): string {
  const raw = (process.env.YUANIO_TELEGRAM_API_BASE || "").trim();
  const base = raw || "https://api.telegram.org";
  return base.replace(/\/+$/, "");
}

function buildApiUrl(botToken: string, method: string): string {
  return `${resolveTelegramApiBase()}/bot${botToken}/${method}`;
}

function parseRetryAfterSeconds(description: string | undefined): number | null {
  if (!description) return null;
  const match = description.match(/retry after\s+(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.floor(seconds);
}

function shouldWarn(method: string, nowMs = Date.now()): boolean {
  const last = telegramMethodWarnAt.get(method) || 0;
  if (nowMs - last < TELEGRAM_WARN_COOLDOWN_MS) return false;
  telegramMethodWarnAt.set(method, nowMs);
  return true;
}

export async function telegramApi<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  keysOverride?: StoredKeys,
): Promise<TelegramApiResult<T> | null> {
  const auth = resolveAuth(keysOverride);
  if (!auth) return null;

  const url = buildApiUrl(auth.botToken, method);
  const nowMs = Date.now();
  const backoffUntil = telegramMethodBackoffUntil.get(method) || 0;
  if (backoffUntil > nowMs) {
    return {
      ok: false,
      description: `rate limited; retry after ${Math.ceil((backoffUntil - nowMs) / 1000)}s`,
    };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as TelegramApiResult<T>;
      if (!parsed.ok) {
        const reason = parsed.description || text.slice(0, 160);
        const retryAfterSec = parseRetryAfterSeconds(reason);
        if (retryAfterSec !== null) {
          telegramMethodBackoffUntil.set(method, Date.now() + retryAfterSec * 1000);
        }
        if (!/message is not modified/i.test(reason)) {
          if (retryAfterSec === null || shouldWarn(method)) {
            console.warn(`[telegram] ${method} api error: ${reason}`);
          }
        }
      }
      return parsed;
    } catch {
      return { ok: false, description: `non-json response: ${text.slice(0, 160)}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (shouldWarn(method)) {
      console.warn(`[telegram] ${method} failed: ${msg}`);
    }
    return null;
  }
}

export function loadTelegramChatId(): string | null {
  const auth = resolveAuth();
  return auth?.chatId || null;
}

export async function sendTelegramMessage(options: TelegramSendMessageOptions): Promise<number | null> {
  const auth = resolveAuth();
  if (!auth) return null;

  const result = await telegramApi<{ message_id?: number }>(
    "sendMessage",
    {
      chat_id: options.chatId || auth.chatId,
      text: options.text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      ...(typeof options.disableNotification === "boolean"
        ? { disable_notification: options.disableNotification }
        : {}),
    },
  );
  if (!result?.ok) return null;
  return typeof result.result?.message_id === "number" ? result.result.message_id : null;
}

export async function sendTelegram(text: string) {
  await sendTelegramMessage({ text, parseMode: "Markdown" });
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
  parseMode?: "Markdown" | "HTML",
): Promise<boolean> {
  const result = await telegramApi(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
  );
  if (!result) return false;
  if (result.ok) return true;
  // Telegram 在文本未变化时会返回 400 "message is not modified"；
  // 对我们的实时渲染链路应视为幂等成功，避免 fallback 触发重复 sendMessage。
  return /message is not modified/i.test(result.description || "");
}

export async function answerTelegramCallback(callbackQueryId: string, text?: string): Promise<void> {
  await telegramApi(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    },
  );
}

export async function setTelegramMessageReaction(
  chatId: string,
  messageId: number,
  emoji = "✅",
): Promise<boolean> {
  const result = await telegramApi("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  });
  return !!result?.ok;
}

export async function sendTelegramChatAction(chatId: string, action: "typing" | "upload_photo" | "upload_document" = "typing"): Promise<boolean> {
  const result = await telegramApi("sendChatAction", {
    chat_id: chatId,
    action,
  });
  return !!result?.ok;
}

export async function setTelegramCommands(commands: TelegramCommandItem[]): Promise<boolean> {
  const result = await telegramApi("setMyCommands", { commands });
  return !!result?.ok;
}

export async function setTelegramWebhook(options: TelegramWebhookOptions): Promise<boolean> {
  const payload: Record<string, unknown> = {
    url: options.url,
  };
  if (options.secretToken) payload.secret_token = options.secretToken;
  if (options.allowedUpdates) payload.allowed_updates = options.allowedUpdates;
  if (typeof options.dropPendingUpdates === "boolean") payload.drop_pending_updates = options.dropPendingUpdates;
  if (typeof options.maxConnections === "number") payload.max_connections = options.maxConnections;
  if (options.ipAddress) payload.ip_address = options.ipAddress;

  const result = await telegramApi("setWebhook", payload);
  return !!result?.ok;
}

export async function deleteTelegramWebhook(dropPendingUpdates = false): Promise<boolean> {
  const result = await telegramApi("deleteWebhook", { drop_pending_updates: dropPendingUpdates });
  return !!result?.ok;
}

export async function getTelegramWebhookInfo(): Promise<TelegramWebhookInfo | null> {
  const result = await telegramApi<TelegramWebhookInfo>("getWebhookInfo", {});
  if (!result?.ok) return null;
  return result.result || null;
}

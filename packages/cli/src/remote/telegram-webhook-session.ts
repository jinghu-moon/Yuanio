import type { TelegramCommandItem } from "../telegram";
import type { TelegramWebhookHandlers } from "../telegram-webhook";
import { loadTelegramChatId } from "../telegram";
import { resolveTelegramRuntimeConfig } from "./telegram-runtime-config";
import { startTelegramWebhookRuntime } from "./telegram-webhook-runtime";

export interface TelegramWebhookSessionState {
  autoDeleteWebhook: boolean;
  stopTelegramWebhook: (() => Promise<void>) | null;
  telegramWebhookRegistered: boolean;
}

export async function startTelegramWebhookSession(options: {
  env?: NodeJS.ProcessEnv;
  handlers: TelegramWebhookHandlers;
  commands: readonly TelegramCommandItem[];
}): Promise<TelegramWebhookSessionState> {
  const env = options.env || process.env;
  const {
    autoDeleteWebhook,
    dropPendingOnRegister,
    enableTelegramWebhook,
    webhookPath,
    webhookPort,
    webhookSecret,
    webhookUrlRaw,
  } = resolveTelegramRuntimeConfig(env);

  const webhookChatId = loadTelegramChatId();
  const runtime = await startTelegramWebhookRuntime({
    enableWebhook: enableTelegramWebhook,
    webhookChatId,
    webhookPath,
    webhookPort,
    webhookSecret,
    webhookUrlRaw,
    dropPendingOnRegister,
    handlers: options.handlers,
    commands: options.commands,
  });

  return {
    autoDeleteWebhook,
    stopTelegramWebhook: runtime.stopTelegramWebhook,
    telegramWebhookRegistered: runtime.telegramWebhookRegistered,
  };
}

import type { TelegramCommandItem } from "../telegram";
import type { TelegramWebhookHandlers } from "../telegram-webhook";
import { startTelegramWebhookSession } from "./telegram-webhook-session";
import { createRemoteCleanup } from "./remote-cleanup";

export interface CreateWebhookSessionCleanupOptions {
  env?: NodeJS.ProcessEnv;
  handlers: TelegramWebhookHandlers;
  commands: readonly TelegramCommandItem[];
  runStopHook: () => Promise<void>;
  stopHeartbeat: () => void;
  stopPty: () => void;
  deleteTelegramWebhook: (dropPending?: boolean) => Promise<boolean>;
  disposeInboundTracker: () => void;
}

export async function createWebhookSessionCleanup(options: CreateWebhookSessionCleanupOptions) {
  const webhookSession = await startTelegramWebhookSession({
    env: options.env,
    handlers: options.handlers,
    commands: options.commands,
  });

  const autoDeleteWebhook = webhookSession.autoDeleteWebhook;
  let stopTelegramWebhook = webhookSession.stopTelegramWebhook;
  let telegramWebhookRegistered = webhookSession.telegramWebhookRegistered;

  return createRemoteCleanup({
    runStopHook: options.runStopHook,
    stopHeartbeat: options.stopHeartbeat,
    stopPty: options.stopPty,
    getStopTelegramWebhook: () => stopTelegramWebhook,
    clearStopTelegramWebhook: () => {
      stopTelegramWebhook = null;
    },
    isTelegramWebhookRegistered: () => telegramWebhookRegistered,
    clearTelegramWebhookRegistered: () => {
      telegramWebhookRegistered = false;
    },
    autoDeleteWebhook,
    deleteTelegramWebhook: options.deleteTelegramWebhook,
    disposeInboundTracker: options.disposeInboundTracker,
  });
}

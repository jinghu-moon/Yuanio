import {
  setTelegramCommands,
  setTelegramWebhook,
  type TelegramCommandItem,
} from "../telegram";
import {
  startTelegramWebhookServer,
  type TelegramWebhookHandlers,
} from "../telegram-webhook";

export interface StartTelegramWebhookRuntimeOptions {
  enableWebhook: boolean;
  webhookChatId: string | null;
  webhookPath: string;
  webhookPort: number;
  webhookSecret?: string;
  webhookUrlRaw: string;
  dropPendingOnRegister: boolean;
  handlers: TelegramWebhookHandlers;
  commands: readonly TelegramCommandItem[];
}

export interface TelegramWebhookRuntimeStartResult {
  stopTelegramWebhook: (() => Promise<void>) | null;
  telegramWebhookRegistered: boolean;
}

export async function startTelegramWebhookRuntime(
  options: StartTelegramWebhookRuntimeOptions,
): Promise<TelegramWebhookRuntimeStartResult> {
  let stopTelegramWebhook: (() => Promise<void>) | null = null;
  let telegramWebhookRegistered = false;

  if (!options.enableWebhook || !options.webhookChatId) {
    return { stopTelegramWebhook, telegramWebhookRegistered };
  }

  try {
    const webhookServer = await startTelegramWebhookServer({
      port: options.webhookPort,
      path: options.webhookPath,
      secretToken: options.webhookSecret,
      allowedChatId: options.webhookChatId,
      handlers: options.handlers,
    });
    stopTelegramWebhook = webhookServer.stop;
    console.log(`[telegram] webhook server 已启动: http://0.0.0.0:${webhookServer.port}${webhookServer.path}`);

    void setTelegramCommands([...options.commands]);

    if (options.webhookUrlRaw) {
      try {
        const u = new URL(options.webhookUrlRaw);
        if (!u.pathname || u.pathname === "/") u.pathname = webhookServer.path;
        const webhookUrl = u.toString();
        const ok = await setTelegramWebhook({
          url: webhookUrl,
          secretToken: options.webhookSecret,
          allowedUpdates: ["message", "callback_query"],
          dropPendingUpdates: options.dropPendingOnRegister,
        });
        if (ok) {
          console.log(`[telegram] webhook 已注册: ${webhookUrl}`);
          telegramWebhookRegistered = true;
        } else {
          console.warn(`[telegram] webhook 注册失败: ${webhookUrl}`);
        }
      } catch {
        console.warn(`[telegram] webhook URL 无效: ${options.webhookUrlRaw}`);
      }
    } else {
      console.log("[telegram] 未设置 YUANIO_TELEGRAM_WEBHOOK_URL，已仅启动本地 webhook server");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[telegram] webhook 启动失败: ${msg}`);
  }

  return { stopTelegramWebhook, telegramWebhookRegistered };
}

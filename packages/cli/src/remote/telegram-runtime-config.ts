export interface TelegramRuntimeConfig {
  autoDeleteWebhook: boolean;
  dropPendingOnRegister: boolean;
  enableTelegramWebhook: boolean;
  webhookPath: string;
  webhookPort: number;
  webhookSecret?: string;
  webhookUrlRaw: string;
}

export function resolveTelegramRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramRuntimeConfig {
  const autoDeleteWebhook = env.YUANIO_TELEGRAM_AUTO_DELETE_WEBHOOK !== "0";
  const dropPendingOnRegister = env.YUANIO_TELEGRAM_WEBHOOK_DROP_PENDING !== "0";
  const enableTelegramWebhook = env.YUANIO_TELEGRAM_WEBHOOK_ENABLED === "1"
    || !!env.YUANIO_TELEGRAM_WEBHOOK_URL;
  const webhookPath = env.YUANIO_TELEGRAM_WEBHOOK_PATH || "/telegram/webhook";
  const webhookPortRaw = Number(env.YUANIO_TELEGRAM_WEBHOOK_PORT || "");
  const webhookPort = Number.isFinite(webhookPortRaw) && webhookPortRaw > 0
    ? Math.floor(webhookPortRaw)
    : 8787;
  const webhookSecret = env.YUANIO_TELEGRAM_WEBHOOK_SECRET || undefined;
  const webhookUrlRaw = (env.YUANIO_TELEGRAM_WEBHOOK_URL || "").trim();
  return {
    autoDeleteWebhook,
    dropPendingOnRegister,
    enableTelegramWebhook,
    webhookPath,
    webhookPort,
    webhookSecret,
    webhookUrlRaw,
  };
}

export interface CreateRemoteCleanupOptions {
  runStopHook: () => Promise<void>;
  stopHeartbeat: () => void;
  stopPty: () => void;
  getStopTelegramWebhook: () => (() => Promise<void>) | null;
  clearStopTelegramWebhook: () => void;
  isTelegramWebhookRegistered: () => boolean;
  clearTelegramWebhookRegistered: () => void;
  autoDeleteWebhook: boolean;
  deleteTelegramWebhook: (dropPending?: boolean) => Promise<boolean>;
  disposeInboundTracker: () => void;
}

export function createRemoteCleanup(options: CreateRemoteCleanupOptions) {
  return () => {
    void options.runStopHook().catch(() => {});
    options.stopHeartbeat();
    options.stopPty();

    const stopTelegramWebhook = options.getStopTelegramWebhook();
    if (stopTelegramWebhook) {
      void stopTelegramWebhook().catch(() => {});
      options.clearStopTelegramWebhook();
    }

    if (options.isTelegramWebhookRegistered() && options.autoDeleteWebhook) {
      void options.deleteTelegramWebhook(false).then((ok) => {
        if (ok) {
          console.log("[telegram] webhook 已删除");
        } else {
          console.warn("[telegram] webhook 删除失败");
        }
      }).catch(() => {});
      options.clearTelegramWebhookRegistered();
    }

    options.disposeInboundTracker();
  };
}

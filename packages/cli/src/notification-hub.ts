import { eventBus, type YuanioEvent } from "./event-bus";
import type { PushService } from "./push-service";

export interface NotificationHubOptions {
  readyCooldownMs?: number;
  permissionDebounceMs?: number;
}

export class NotificationHub {
  private readonly readyCooldownMs: number;
  private readonly permissionDebounceMs: number;
  private readonly permissionTimers = new Map<string, Timer>();
  private readonly lastReadyAt = new Map<string, number>();
  private unsub: (() => void) | null = null;

  constructor(
    private readonly pushService: PushService,
    options?: NotificationHubOptions,
  ) {
    this.readyCooldownMs = options?.readyCooldownMs ?? 5000;
    this.permissionDebounceMs = options?.permissionDebounceMs ?? 500;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = eventBus.subscribe((event) => {
      this.handleEvent(event).catch((e) => {
        console.error("[notify] hub error:", e instanceof Error ? e.message : e);
      });
    });
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    for (const timer of this.permissionTimers.values()) {
      clearTimeout(timer);
    }
    this.permissionTimers.clear();
    this.lastReadyAt.clear();
  }

  private async handleEvent(event: YuanioEvent): Promise<void> {
    if (event.type === "approval-requested") {
      this.queuePermission(event.sessionId);
      return;
    }
    if (event.type === "task-completed") {
      await this.maybeSendReady(event.taskId);
    }
  }

  private queuePermission(sessionId: string): void {
    const old = this.permissionTimers.get(sessionId);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.permissionTimers.delete(sessionId);
      void this.pushService.sendToAll("需要审批", `会话 ${sessionId} 请求审批`);
    }, this.permissionDebounceMs);
    this.permissionTimers.set(sessionId, timer);
  }

  private async maybeSendReady(taskId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastReadyAt.get(taskId) ?? 0;
    if (now - last < this.readyCooldownMs) return;
    this.lastReadyAt.set(taskId, now);
    await this.pushService.sendToAll("任务完成", `任务 ${taskId} 已完成`);
  }
}

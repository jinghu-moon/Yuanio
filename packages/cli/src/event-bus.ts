import type { AgentStatus, PermissionMode } from "@yuanio/shared";

// ── 模型模式（Phase 9 前置定义）──

export type ModelMode = "default" | "sonnet" | "opus";

// ── 事件类型 ──

export type YuanioEvent =
  | { type: "session-updated"; sessionId: string; data?: unknown }
  | { type: "session-added"; sessionId: string }
  | { type: "session-removed"; sessionId: string }
  | { type: "message-received"; sessionId: string; message: unknown }
  | { type: "approval-requested"; sessionId: string; requestId: string }
  | { type: "approval-resolved"; sessionId: string; requestId: string; approved: boolean }
  | { type: "task-completed"; taskId: string; summary?: unknown }
  | { type: "status-changed"; status: AgentStatus }
  | { type: "permission-mode-changed"; mode: PermissionMode }
  | { type: "model-mode-changed"; mode: ModelMode };

export type EventListener = (event: YuanioEvent) => void;

// ── EventBus ──

export class EventBus {
  private listeners = new Set<EventListener>();

  /** 订阅事件，返回取消订阅函数 */
  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** 发布事件，错误隔离 */
  emit(event: YuanioEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (e) {
        console.error("[event-bus] listener error:", e instanceof Error ? e.message : e);
      }
    }
  }

  /** 当前订阅者数量 */
  get size(): number {
    return this.listeners.size;
  }
}

/** 全局单例 */
export const eventBus = new EventBus();

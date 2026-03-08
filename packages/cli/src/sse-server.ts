import type { YuanioEvent } from "./event-bus";
import { eventBus } from "./event-bus";

// ── 类型 ──

interface SSEConnection {
  controller: ReadableStreamDefaultController;
  sessionId?: string;
}

// ── SSEManager ──

export class SSEManager {
  private connections = new Map<string, SSEConnection>();
  private heartbeatTimer: Timer | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    // 30s 心跳保活
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
  }

  /** 创建 SSE 响应 */
  createResponse(id: string, sessionId?: string): Response {
    const stream = new ReadableStream({
      start: (controller) => {
        this.connections.set(id, { controller, sessionId });
        // 发送初始连接确认
        controller.enqueue(this.formatEvent("connected", { id }));
      },
      cancel: () => {
        this.connections.delete(id);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  /** 广播事件到匹配的连接 */
  broadcast(event: YuanioEvent): void {
    for (const [id, conn] of this.connections) {
      try {
        // 按 sessionId 过滤
        if (conn.sessionId && "sessionId" in event && event.sessionId !== conn.sessionId) {
          continue;
        }
        conn.controller.enqueue(this.formatEvent(event.type, event));
      } catch {
        this.connections.delete(id);
      }
    }
  }

  /** 移除连接 */
  remove(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      try { conn.controller.close(); } catch {}
      this.connections.delete(id);
    }
  }

  /** 心跳保活 */
  private heartbeat(): void {
    for (const [id, conn] of this.connections) {
      try {
        conn.controller.enqueue(": ping\n\n");
      } catch {
        this.connections.delete(id);
      }
    }
  }

  /** 格式化 SSE 事件 */
  private formatEvent(eventType: string, data: unknown): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /** 活跃连接数 */
  get activeCount(): number {
    return this.connections.size;
  }

  /** 停止 */
  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.unsubscribe) this.unsubscribe();
    for (const [, conn] of this.connections) {
      try { conn.controller.close(); } catch {}
    }
    this.connections.clear();
  }

  /** 绑定 EventBus */
  bindEventBus(): void {
    this.unsubscribe = eventBus.subscribe((event) => this.broadcast(event));
  }
}

import { io, Socket } from "socket.io-client";
import type { Envelope, BinaryEnvelope, AckMessage, AckState } from "@yuanio/shared";
import { createRelaySocketOptions, ensurePollingFallback } from "./relay-options";

const ACK_TIMEOUT = 5000;
const ACK_MAX_RETRIES = 3;
const OFFLINE_QUEUE_MAX = Number(process.env.YUANIO_RELAY_OFFLINE_QUEUE_MAX ?? 1000);

export class RelayClient {
  private socket: Socket;
  private serverUrl: string;
  private options: ReturnType<typeof createRelaySocketOptions>;
  private _onMessage: ((envelope: Envelope | BinaryEnvelope) => void) | null = null;
  private _onDeviceOnline: (() => void) | null = null;
  private _onConnectionChange: ((connected: boolean) => void) | null = null;
  private pendingAcks = new Map<string, { resolve: () => void; timer: Timer }>();
  private offlineQueue: Envelope[] = [];
  private _connected = false;
  private fallbackApplied = false;
  private authRejected = false;
  private droppedWhileAuthRejected = 0;

  get connected(): boolean { return this._connected; }

  constructor(serverUrl: string, sessionToken: string) {
    this.serverUrl = serverUrl;
    this.options = createRelaySocketOptions(sessionToken);
    this.socket = this.createSocket();
  }

  private createSocket(): Socket {
    const socket = io(`${this.serverUrl}/relay`, this.options);
    this.attachSocketHandlers(socket);
    return socket;
  }

  private attachSocketHandlers(socket: Socket) {

    socket.on("connect", () => {
      this._connected = true;
      this.authRejected = false;
      this.droppedWhileAuthRejected = 0;
      this._onConnectionChange?.(true);
      // 重连后补发离线消息
      if (this.offlineQueue.length > 0) {
        console.log(`[relay] 补发 ${this.offlineQueue.length} 条离线消息`);
        for (const env of this.offlineQueue) {
          socket.emit("message", env);
        }
        this.offlineQueue = [];
      }
      console.log("[relay] 已连接");
    });

    socket.on("message", (envelope: Envelope) => {
      this._onMessage?.(envelope);
    });

    socket.on("device:online", () => {
      this._onDeviceOnline?.();
    });

    // ACK 监听：收到确认后清除重发定时器
    socket.on("ack", (ack: AckMessage) => {
      if (ack.state === "retry_after") return;
      const pending = this.pendingAcks.get(ack.messageId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(ack.messageId);
        pending.resolve();
      }
    });

    socket.on("disconnect", (reason) => {
      this._connected = false;
      this._onConnectionChange?.(false);
      console.log(`[relay] 已断开 (${reason})`);
    });

    socket.on("connect_error", (err) => {
      const msg = err.message || "";
      if (msg.includes("invalid or expired token") || msg.includes("auth token required")) {
        this.authRejected = true;
      }
      if (err.message.includes("protocol mismatch")) {
        console.error("[relay] 协议版本不兼容，请升级 CLI 或 relay 服务");
      }
      if (!this.fallbackApplied) {
        this.fallbackApplied = ensurePollingFallback(this.options, (msg) => console.warn(msg));
        if (this.fallbackApplied) {
          socket.removeAllListeners();
          socket.disconnect();
          this.socket = this.createSocket();
        }
      }
      console.error("[relay] 连接错误:", err.message);
    });
  }

  send(envelope: Envelope | BinaryEnvelope) {
    if (this._connected) {
      this.socket.emit("message", envelope);
    } else {
      // binary 信封不缓存（PTY 数据过期无意义）
      if (envelope.payload instanceof Uint8Array) return;
      if (this.authRejected) {
        this.droppedWhileAuthRejected += 1;
        if (this.droppedWhileAuthRejected === 1 || this.droppedWhileAuthRejected % 100 === 0) {
          console.warn(`[relay] token 无效，已丢弃 ${this.droppedWhileAuthRejected} 条待发消息（请重新 --pair）`);
        }
        return;
      }
      this.offlineQueue.push(envelope as Envelope);
      if (this.offlineQueue.length > OFFLINE_QUEUE_MAX) {
        this.offlineQueue.splice(0, this.offlineQueue.length - OFFLINE_QUEUE_MAX);
      }
      console.log(`[relay] 离线缓存 (${this.offlineQueue.length} 条待发)`);
    }
  }

  // 可靠发送：带 ACK 确认 + 超时重发
  sendReliable(envelope: Envelope): Promise<void> {
    return new Promise((resolve, reject) => {
      let retries = 0;

      const attempt = () => {
        this.socket.emit("message", envelope);
        const timer = setTimeout(() => {
          retries++;
          if (retries >= ACK_MAX_RETRIES) {
            this.pendingAcks.delete(envelope.id);
            reject(new Error(`ACK 超时: ${envelope.id} (${retries} 次重试)`));
          } else {
            console.log(`[relay] 重发 ${envelope.id} (第 ${retries} 次)`);
            attempt();
          }
        }, ACK_TIMEOUT);
        this.pendingAcks.set(envelope.id, { resolve, timer });
      };

      attempt();
    });
  }

  // 发送 ACK 确认
  sendAck(
    messageId: string,
    deviceId: string,
    sessionId: string,
    state: AckState = "ok",
    options?: { retryAfterMs?: number; reason?: string },
  ) {
    const ack: AckMessage = {
      messageId,
      source: deviceId,
      sessionId,
      state,
      retryAfterMs: options?.retryAfterMs,
      reason: options?.reason,
      at: Date.now(),
    };
    this.socket.emit("ack", ack);
  }

  onMessage(handler: (envelope: Envelope | BinaryEnvelope) => void) {
    this._onMessage = handler;
  }

  onDeviceOnline(handler: () => void) {
    this._onDeviceOnline = handler;
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this._onConnectionChange = handler;
  }

  disconnect() {
    this.socket.disconnect();
  }

  reconnect(sessionToken: string) {
    this.options = createRelaySocketOptions(sessionToken);
    this.fallbackApplied = false;
    this.pendingAcks.forEach((p) => clearTimeout(p.timer));
    this.pendingAcks.clear();
    this.offlineQueue = [];
    this._connected = false;
    this.authRejected = false;
    this.droppedWhileAuthRejected = 0;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = this.createSocket();
  }
}

import { WebSocket } from "ws";
import type { RawData } from "ws";
import type { Envelope, BinaryEnvelope, AckMessage, AckState } from "@yuanio/shared";
import {
  buildRelayWsUrl,
  createRelayHelloFrame,
  decodeWsData,
  encodeWsFrame,
  normalizeEnvelopePayload,
  parseWsFrame,
  toWsAckFrame,
  toWsMessageFrame,
} from "./relay-options";

const ACK_TIMEOUT = 5000;
const ACK_MAX_RETRIES = 3;
const OFFLINE_QUEUE_MAX = Number(process.env.YUANIO_RELAY_OFFLINE_QUEUE_MAX ?? 1000);
const RECONNECT_DELAY_MS = 300;
const RECONNECT_DELAY_MAX_MS = 5000;
const RECONNECT_RANDOMIZATION_FACTOR = 0.2;

export class RelayClient {
  private socket: WebSocket;
  private serverUrl: string;
  private sessionToken: string;
  private _onMessage: ((envelope: Envelope | BinaryEnvelope) => void) | null = null;
  private _onDeviceOnline: (() => void) | null = null;
  private _onConnectionChange: ((connected: boolean) => void) | null = null;
  private _onError: ((message: string) => void) | null = null;
  private pendingAcks = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  private offlineQueue: Envelope[] = [];
  private _connected = false;
  private authRejected = false;
  private droppedWhileAuthRejected = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;

  get connected(): boolean { return this._connected; }

  constructor(serverUrl: string, sessionToken: string) {
    this.serverUrl = serverUrl;
    this.sessionToken = sessionToken;
    this.socket = this.createSocket();
  }

  private createSocket(): WebSocket {
    const socket = new WebSocket(buildRelayWsUrl(this.serverUrl));
    this.attachSocketHandlers(socket);
    return socket;
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    if (this.reconnectTimer) return;
    const baseDelay = Math.min(RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS * (2 ** this.reconnectAttempts));
    const jitter = baseDelay * RECONNECT_RANDOMIZATION_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.floor(baseDelay + jitter));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      this.socket = this.createSocket();
    }, delay);
  }

  private clearReconnectState() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private sendWsFrame(socket: WebSocket, frame: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeWsFrame(frame));
  }

  private attachSocketHandlers(socket: WebSocket) {
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this._connected = true;
      this.authRejected = false;
      this.droppedWhileAuthRejected = 0;
      this.closedByUser = false;
      this.clearReconnectState();
      this._onConnectionChange?.(true);
      this.sendWsFrame(socket, createRelayHelloFrame(this.sessionToken));
      if (this.offlineQueue.length > 0) {
        console.log(`[relay] 补发 ${this.offlineQueue.length} 条离线消息`);
        for (const env of this.offlineQueue) {
          this.sendWsFrame(socket, toWsMessageFrame(env));
        }
        this.offlineQueue = [];
      }
      console.log("[relay] 已连接");
    });

    socket.on("message", (data: RawData) => {
      if (this.socket !== socket) return;
      const raw = decodeWsData(data);
      const parsed = parseWsFrame(raw);
      if (!parsed.ok) {
        this._onError?.(parsed.error);
        return;
      }
      const frame = parsed.frame as { type: string; data?: any };
      if (frame.type === "message" && frame.data) {
        const normalized = normalizeEnvelopePayload(frame.data as Envelope | BinaryEnvelope);
        this._onMessage?.(normalized);
        return;
      }
      if (frame.type === "ack" && frame.data) {
        const ack = frame.data as AckMessage;
        if (ack.state === "retry_after") return;
        const pending = this.pendingAcks.get(ack.messageId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingAcks.delete(ack.messageId);
          pending.resolve();
        }
        return;
      }
      if (frame.type === "presence") {
        this._onDeviceOnline?.();
        return;
      }
      if (frame.type === "error") {
        const code = frame.data?.code as string | undefined;
        const message = String(frame.data?.message ?? "relay error");
        if (code === "auth_failed") {
          this.authRejected = true;
        }
        if (message.includes("protocol mismatch")) {
          console.error("[relay] 协议版本不兼容，请升级 CLI 或 relay 服务");
        }
        this._onError?.(message);
      }
    });

    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this._connected = false;
      this._onConnectionChange?.(false);
      const detail = reason ? ` ${reason.toString()}` : "";
      console.log(`[relay] 已断开 (${code}${detail})`);
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      if (this.socket !== socket) return;
      const message = err instanceof Error ? err.message : String(err);
      this._onError?.(message);
      console.error("[relay] 连接错误:", message);
    });
  }

  send(envelope: Envelope | BinaryEnvelope) {
    if (this._connected) {
      this.sendWsFrame(this.socket, toWsMessageFrame(envelope));
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
        this.sendWsFrame(this.socket, toWsMessageFrame(envelope));
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
    this.sendWsFrame(this.socket, toWsAckFrame(ack));
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

  onError(handler: (message: string) => void) {
    this._onError = handler;
  }

  disconnect() {
    this.closedByUser = true;
    this.clearReconnectState();
    this.socket.removeAllListeners();
    this.socket.close();
  }

  reconnect(sessionToken: string) {
    this.sessionToken = sessionToken;
    this.closedByUser = false;
    this.clearReconnectState();
    this.pendingAcks.forEach((p) => clearTimeout(p.timer));
    this.pendingAcks.clear();
    this.offlineQueue = [];
    this._connected = false;
    this.authRejected = false;
    this.droppedWhileAuthRejected = 0;
    this.socket.removeAllListeners();
    this.socket.close();
    this.socket = this.createSocket();
  }
}

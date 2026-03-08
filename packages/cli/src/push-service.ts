import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { eventBus } from "./event-bus";
import type { YuanioEvent } from "./event-bus";

const YUANIO_DIR = `${process.env.HOME || process.env.USERPROFILE}/.yuanio`;
const VAPID_FILE = `${YUANIO_DIR}/vapid.json`;
const SUBSCRIPTIONS_FILE = `${YUANIO_DIR}/push-subscriptions.json`;

// ── 类型 ──

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

// ── VAPID 密钥管理 ──

function loadVapidKeys(): VapidKeys | null {
  try {
    if (!existsSync(VAPID_FILE)) return null;
    return JSON.parse(readFileSync(VAPID_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveVapidKeys(keys: VapidKeys): void {
  mkdirSync(YUANIO_DIR, { recursive: true });
  writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
}

// ── 订阅管理 ──

function loadSubscriptions(): PushSubscription[] {
  try {
    if (!existsSync(SUBSCRIPTIONS_FILE)) return [];
    return JSON.parse(readFileSync(SUBSCRIPTIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveSubscriptions(subs: PushSubscription[]): void {
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
}

// ── PushService ──

export class PushService {
  private vapidKeys: VapidKeys | null = null;
  private unsubscribe: (() => void) | null = null;
  private sseActiveCount: () => number;

  constructor(sseActiveCount: () => number) {
    this.sseActiveCount = sseActiveCount;
    this.vapidKeys = loadVapidKeys();
  }

  /** 获取或生成 VAPID 公钥 */
  getPublicKey(): string | null {
    if (!this.vapidKeys) {
      this.vapidKeys = this.generateVapidKeys();
      if (!this.vapidKeys) return null;
    }
    return this.vapidKeys.publicKey;
  }

  /** 生成 VAPID 密钥对 */
  private generateVapidKeys(): VapidKeys | null {
    try {
      const { generateKeyPairSync } = require("node:crypto");
      const { publicKey, privateKey } = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        publicKeyEncoding: { type: "spki", format: "der" },
        privateKeyEncoding: { type: "pkcs8", format: "der" },
      });
      const keys: VapidKeys = {
        publicKey: Buffer.from(publicKey).toString("base64url"),
        privateKey: Buffer.from(privateKey).toString("base64url"),
        subject: "mailto:yuanio@localhost",
      };
      saveVapidKeys(keys);
      return keys;
    } catch (e) {
      console.error("[push] VAPID 密钥生成失败:", e);
      return null;
    }
  }

  /** 注册推送订阅 */
  subscribe(endpoint: string, keys: { p256dh: string; auth: string }): void {
    const subs = loadSubscriptions();
    // 去重
    const exists = subs.some((s) => s.endpoint === endpoint);
    if (!exists) {
      subs.push({ endpoint, keys, createdAt: Date.now() });
      saveSubscriptions(subs);
    }
  }

  /** 取消订阅 */
  unsubscribeEndpoint(endpoint: string): boolean {
    const subs = loadSubscriptions();
    const idx = subs.findIndex((s) => s.endpoint === endpoint);
    if (idx === -1) return false;
    subs.splice(idx, 1);
    saveSubscriptions(subs);
    return true;
  }

  /** 向所有订阅者发送推送 */
  async sendToAll(title: string, body: string, _url?: string): Promise<number> {
    const subs = loadSubscriptions();
    if (subs.length === 0) return 0;

    let sent = 0;
    const expired: string[] = [];

    for (const sub of subs) {
      try {
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body }),
        });
        if (res.status === 410) {
          expired.push(sub.endpoint);
        } else if (res.ok) {
          sent++;
        }
      } catch {
        // 网络错误，跳过
      }
    }

    // 清理过期订阅
    if (expired.length > 0) {
      const remaining = subs.filter((s) => !expired.includes(s.endpoint));
      saveSubscriptions(remaining);
    }

    return sent;
  }

  /** 绑定 EventBus，仅在无 SSE 活跃连接时发送推送 */
  bindEventBus(): void {
    this.unsubscribe = eventBus.subscribe((event) => {
      // 仅在无 SSE 连接时降级为推送
      if (this.sseActiveCount() > 0) return;
      this.handleEvent(event);
    });
  }

  private handleEvent(event: YuanioEvent): void {
    if (event.type === "approval-requested") {
      void this.sendToAll("需要审批", `会话 ${event.sessionId} 请求审批`);
    } else if (event.type === "task-completed") {
      void this.sendToAll("任务完成", `任务 ${event.taskId} 已完成`);
    }
  }

  /** 停止 */
  stop(): void {
    if (this.unsubscribe) this.unsubscribe();
  }
}

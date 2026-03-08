import type { TaskQueueStatusPayload } from "@yuanio/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface QueueItem {
  id: string;
  prompt: string;
  agent?: string;
  priority: number;
  createdAt: number;
}

let queue: QueueItem[] = [];
let queueSeq = 0;
let queueMode: "sequential" | "parallel" = "sequential";

const QUEUE_DIR = ".yuanio";
const QUEUE_FILE = join(QUEUE_DIR, "queue.json");
const QUEUE_FILE_VERSION = 1;

type QueueFile = {
  version: number;
  mode: "sequential" | "parallel";
  seq: number;
  items: QueueItem[];
};

export function getQueueMode() { return queueMode; }
export function setQueueMode(mode: "sequential" | "parallel") {
  queueMode = mode;
  persistQueue();
}

/** 入队 */
export function enqueue(prompt: string, agent?: string, priority = 0): QueueItem {
  const item: QueueItem = {
    id: `q_${++queueSeq}`,
    prompt,
    agent,
    priority,
    createdAt: Date.now(),
  };
  queue.push(item);
  // 按优先级降序排列
  queue.sort((a, b) => b.priority - a.priority);
  persistQueue();
  return item;
}

/** 出队（取最高优先级） */
export function dequeue(): QueueItem | undefined {
  const item = queue.shift();
  if (item) persistQueue();
  return item;
}

/** 查看队列 */
export function peekAll(): QueueItem[] {
  return [...queue];
}

/** 清空队列 */
export function clearQueue(): number {
  const count = queue.length;
  queue = [];
  persistQueue();
  return count;
}

/** 队列长度 */
export function queueSize(): number {
  return queue.length;
}

/** 构建状态 payload */
export function buildQueueStatus(runningTaskIds: string[]): TaskQueueStatusPayload {
  return {
    queued: queue.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      agent: q.agent,
      priority: q.priority,
      createdAt: q.createdAt,
    })),
    running: runningTaskIds,
    mode: queueMode,
  };
}

export function loadQueueFromDisk(): number {
  try {
    if (!existsSync(QUEUE_FILE)) {
      queue = [];
      queueSeq = 0;
      return 0;
    }
    const raw = JSON.parse(readFileSync(QUEUE_FILE, "utf-8")) as Partial<QueueFile>;
    if (!raw || !Array.isArray(raw.items)) {
      queue = [];
      queueSeq = 0;
      return 0;
    }
    const items = raw.items.filter((item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.prompt === "string" &&
      typeof item.priority === "number" &&
      typeof item.createdAt === "number"
    );
    queue = items;
    if (raw.mode === "parallel" || raw.mode === "sequential") queueMode = raw.mode;
    const maxId = items.reduce((max, item) => {
      const match = /^q_(\d+)$/.exec(item.id);
      const n = match ? Number(match[1]) : 0;
      return n > max ? n : max;
    }, 0);
    queueSeq = Math.max(maxId, typeof raw.seq === "number" ? raw.seq : 0);
    return queue.length;
  } catch {
    queue = [];
    queueSeq = 0;
    return 0;
  }
}

export function persistQueue(): void {
  try {
    mkdirSync(QUEUE_DIR, { recursive: true });
    const payload: QueueFile = {
      version: QUEUE_FILE_VERSION,
      mode: queueMode,
      seq: queueSeq,
      items: queue,
    };
    writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2));
  } catch {
    // 持久化失败不影响主流程
  }
}

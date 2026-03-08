import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { IngressPromptSource } from "@yuanio/shared";

export interface CheckpointItem {
  id: string;
  taskId: string;
  promptId?: string;
  agent: string;
  promptPreview: string;
  source: IngressPromptSource;
  createdAt: number;
  cwd: string;
  files: string[];
}

interface CheckpointStoreFile {
  version: 1;
  items: CheckpointItem[];
}

const DEFAULT_MAX_ITEMS = 120;
const CHECKPOINT_FILE = join(homedir(), ".yuanio", "checkpoints.json");

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizePromptPreview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty prompt)";
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

function toCheckpointId(taskId: string, createdAt: number): string {
  const stamp = new Date(createdAt).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `ckpt_${stamp}_${taskId}`;
}

function readStore(filePath = CHECKPOINT_FILE): CheckpointStoreFile {
  if (!existsSync(filePath)) return { version: 1, items: [] };
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CheckpointStoreFile>;
    if (!Array.isArray(parsed.items)) return { version: 1, items: [] };
    return {
      version: 1,
      items: parsed.items
        .filter((item): item is CheckpointItem => !!item && typeof item.id === "string")
        .slice(0, 10_000),
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeStore(data: CheckpointStoreFile, filePath = CHECKPOINT_FILE): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function createCheckpointStore(options?: { maxItems?: number; filePath?: string }) {
  const maxItems = Number.isFinite(options?.maxItems) && (options?.maxItems || 0) > 0
    ? Math.floor(options?.maxItems as number)
    : DEFAULT_MAX_ITEMS;
  const filePath = options?.filePath || CHECKPOINT_FILE;

  const list = (limit = 20): CheckpointItem[] => {
    const store = readStore(filePath);
    return store.items
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  };

  const add = (input: {
    taskId: string;
    promptId?: string;
    agent: string;
    prompt: string;
    source?: IngressPromptSource;
    cwd: string;
    files: string[];
  }): CheckpointItem => {
    const now = Date.now();
    const item: CheckpointItem = {
      id: toCheckpointId(input.taskId, now),
      taskId: input.taskId,
      promptId: input.promptId?.trim() || undefined,
      agent: input.agent,
      promptPreview: normalizePromptPreview(input.prompt),
      source: input.source ?? "unknown",
      createdAt: now,
      cwd: input.cwd,
      files: Array.from(new Set(input.files)).filter(Boolean).slice(0, 200),
    };
    const store = readStore(filePath);
    store.items.unshift(item);
    if (store.items.length > maxItems) store.items = store.items.slice(0, maxItems);
    writeStore(store, filePath);
    return item;
  };

  const get = (id: string): CheckpointItem | null => {
    if (!id) return null;
    const store = readStore(filePath);
    return store.items.find((item) => item.id === id) || null;
  };

  const findByPromptId = (promptId: string): CheckpointItem | null => {
    const target = promptId.trim();
    if (!target) return null;
    const store = readStore(filePath);
    return store.items.find((item) => item.promptId === target) || null;
  };

  return {
    list,
    add,
    get,
    findByPromptId,
  };
}

export async function rollbackFiles(paths: string[]): Promise<{ ok: string[]; failed: string[] }> {
  const uniq = Array.from(new Set(paths)).filter(Boolean);
  const ok: string[] = [];
  const failed: string[] = [];
  for (const path of uniq) {
    try {
      const proc = Bun.spawn(["git", "checkout", "--", path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      if (code === 0) ok.push(path);
      else failed.push(path);
    } catch {
      failed.push(path);
    }
  }
  return { ok, failed };
}

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  loadQueueFromDisk,
  enqueue,
  clearQueue,
  queueSize,
  getQueueMode,
  setQueueMode,
} from "../../task-queue";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("queue-persist", () => {
  let prevCwd = "";
  let tempDir = "";

  beforeEach(() => {
    prevCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "yuanio-queue-"));
    process.chdir(tempDir);
    clearQueue();
    setQueueMode("sequential");
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(tempDir, { recursive: true, force: true });
    clearQueue();
    setQueueMode("sequential");
  });

  it("loadQueueFromDisk 恢复队列与模式", () => {
    const dir = join(tempDir, ".yuanio");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "queue.json");
    writeFileSync(file, JSON.stringify({
      version: 1,
      mode: "parallel",
      seq: 7,
      items: [
        { id: "q_7", prompt: "hello", priority: 1, createdAt: 1 },
      ],
    }, null, 2));

    const restored = loadQueueFromDisk();

    expect(restored).toBe(1);
    expect(queueSize()).toBe(1);
    expect(getQueueMode()).toBe("parallel");
    const next = enqueue("next");
    expect(next.id).toBe("q_8");
  });

  it("enqueue 会持久化到磁盘", () => {
    enqueue("hello");
    const file = join(tempDir, ".yuanio", "queue.json");
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf-8")) as { items: unknown[] };
    expect(raw.items.length).toBe(1);
  });
});

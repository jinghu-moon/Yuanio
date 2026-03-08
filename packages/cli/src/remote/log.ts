import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = ".yuanio";
const LOG_FILE = "remote.log";

export function logEvent(event: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), pid: process.pid, ...event }) + "\n";
    appendFileSync(join(LOG_DIR, LOG_FILE), line, { encoding: "utf8" });
  } catch {
    // 日志失败不影响主流程
  }
}

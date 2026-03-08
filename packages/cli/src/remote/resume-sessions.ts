import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

export interface ResumeSessionOption {
  sessionId: string;
  label: string;
  project?: string;
  timestamp: number;
}

interface ClaudeHistoryRow {
  project?: string;
  display?: string;
  timestamp?: number;
}

const CLAUDE_DIR = join(homedir(), ".claude");
const HISTORY_FILE = join(CLAUDE_DIR, "history.jsonl");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

function safeReadHistory(): ClaudeHistoryRow[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const lines = readFileSync(HISTORY_FILE, "utf-8").split(/\r?\n/).filter(Boolean);
    const rows: ClaudeHistoryRow[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as ClaudeHistoryRow;
        rows.push(row);
      } catch {
        // ignore malformed line
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function normalizeTimestamp(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 兼容秒级时间戳
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

function resolveProjectDirCandidates(projectPath: string): string[] {
  const normalized = projectPath.replace(/[\\/]/g, "-").replace(/^-+/, "");
  if (!normalized) return [];
  return [`-${normalized}`, normalized];
}

function findLatestSessionIdForProject(projectPath: string): string | null {
  if (!projectPath || !existsSync(PROJECTS_DIR)) return null;
  const candidates = resolveProjectDirCandidates(projectPath);
  for (const name of candidates) {
    const dir = join(PROJECTS_DIR, name);
    if (!existsSync(dir)) continue;
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    files.sort((a, b) => {
      try {
        return statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs;
      } catch {
        return 0;
      }
    });
    const latest = files[0];
    return latest.slice(0, -".jsonl".length);
  }
  return null;
}

function fallbackScanRecentSessions(limit: number): ResumeSessionOption[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  const options: ResumeSessionOption[] = [];
  for (const dirName of projectDirs) {
    const dir = join(PROJECTS_DIR, dirName);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    files.sort((a, b) => {
      try {
        return statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs;
      } catch {
        return 0;
      }
    });
    const latest = files[0];
    const sessionId = latest.slice(0, -".jsonl".length);
    const ts = (() => {
      try {
        return statSync(join(dir, latest)).mtimeMs;
      } catch {
        return 0;
      }
    })();
    options.push({
      sessionId,
      label: `${basename(dirName)} · ${new Date(ts).toLocaleString()}`,
      timestamp: ts,
    });
  }
  options.sort((a, b) => b.timestamp - a.timestamp);
  return options.slice(0, limit);
}

export function getRecentResumeSessions(limit = 6): ResumeSessionOption[] {
  const rows = safeReadHistory();
  if (rows.length === 0) return fallbackScanRecentSessions(limit);

  rows.sort((a, b) => normalizeTimestamp(b.timestamp) - normalizeTimestamp(a.timestamp));
  const seen = new Set<string>();
  const options: ResumeSessionOption[] = [];

  for (const row of rows) {
    const projectPath = typeof row.project === "string" ? row.project : "";
    const sessionId = findLatestSessionIdForProject(projectPath);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const ts = normalizeTimestamp(row.timestamp);
    const projectName = projectPath ? basename(projectPath) : "unknown";
    const display = typeof row.display === "string" && row.display.trim()
      ? row.display.trim()
      : projectName;
    const when = ts > 0 ? new Date(ts).toLocaleString() : "unknown time";
    options.push({
      sessionId,
      project: projectPath || undefined,
      timestamp: ts,
      label: `${display} · ${when}`,
    });
    if (options.length >= limit) break;
  }

  if (options.length > 0) return options;
  return fallbackScanRecentSessions(limit);
}

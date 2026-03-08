import type { RpcHandlerMeta } from "./rpc-registry";
import { loadTemplates, saveTemplate, deleteTemplate } from "./templates";
import { loadProjectList, addProject, removeProject } from "../projects";
import { MessageStore } from "../message-store";
import { discoverSkills, listSlashCommandFiles } from "./skill-engine";
import { skillInstallCancel, skillInstallCommit, skillInstallPrepare, skillInstallStatus } from "./skill-install-engine";
import { evaluateCommandSafety } from "./command-safety";
import { basename, resolve, isAbsolute, sep, extname, dirname, relative } from "node:path";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

type FsPromisesModule = typeof import("node:fs/promises");

type DirectorySummary = {
  fileCount: number;
  totalSizeBytes: number;
  partial: boolean;
};

const LS_DIR_SUMMARY_MAX_DEPTH = 8;
const LS_DIR_SUMMARY_MAX_NODES = 5000;
const LS_DIR_SUMMARY_TIMEOUT_MS = 450;
const LS_META_CONCURRENCY = 6;
const UPLOAD_SESSION_TTL_MS = Number(process.env.YUANIO_UPLOAD_SESSION_TTL_MS ?? 60 * 60 * 1000);
const DOWNLOAD_MAX_BYTES = Number(process.env.YUANIO_DOWNLOAD_MAX_BYTES ?? 12 * 1024 * 1024);
const UPLOAD_SUBMITTED_FILE_TTL_MS = Number(process.env.YUANIO_UPLOAD_SUBMITTED_FILE_TTL_MS ?? 10 * 60 * 1000);

type UploadConflictPolicy = "overwrite" | "rename" | "error";

type UploadSession = {
  id: string;
  tempPath: string;
  targetPath: string;
  fileName: string;
  receivedBytes: number;
  totalBytes: number | null;
  mimeType: string | null;
  createdAt: number;
  updatedAt: number;
};

const uploadSessions = new Map<string, UploadSession>();
const uploadedFileCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeCleanupDelay(value: unknown): number | null {
  const n = normalizeNumber(value);
  if (n === null) return null;
  return n > 0 ? Math.max(1_000, n) : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  return null;
}

function normalizeConflictPolicy(value: unknown): UploadConflictPolicy {
  if (value === "overwrite" || value === "error" || value === "rename") return value;
  return "rename";
}

function isLikelyRemoteSource(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return true;
  if (trimmed.startsWith("git@")) return true;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return true;
  return false;
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[/\\]/g, "_");
  return trimmed.length > 0 ? trimmed : "upload.bin";
}

function nowMs(): number {
  return Date.now();
}

function getDirectoryRoots(): string[] {
  if (process.platform !== "win32") return ["/"];
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = String.fromCharCode(code) + ":\\";
    if (existsSync(drive)) roots.push(drive);
  }
  return roots;
}

async function assertDirectoryPath(fs: FsPromisesModule, target: string): Promise<string> {
  const resolved = resolve(target);
  const st = await fs.stat(resolved).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new Error(`directory not found: ${resolved}`);
  }
  return resolved;
}

async function listDirectories(fs: FsPromisesModule, target: string): Promise<{
  cwd: string;
  parent: string | null;
  roots: string[];
  entries: Array<{ name: string; path: string }>;
}> {
  const cwd = await assertDirectoryPath(fs, target);
  const parentDir = dirname(cwd);
  const parent = parentDir === cwd ? null : parentDir;
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: resolve(cwd, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  return {
    cwd,
    parent,
    roots: getDirectoryRoots(),
    entries: dirs,
  };
}

function toPromptRefPath(filePath: string, cwd = process.cwd()): string {
  const normalized = resolve(filePath);
  const rel = relative(cwd, normalized);
  const inProject = rel && !rel.startsWith("..") && !isAbsolute(rel);
  const target = inProject ? rel : normalized;
  return target.split(sep).join("/");
}

function buildUploadPrompt(refPath: string, text?: string): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const atRef = `@${refPath}`;
  return trimmed ? `${trimmed} ${atRef}` : atRef;
}

function scheduleUploadedFileCleanup(pathToDelete: string, delayMs: number): number {
  const key = resolve(pathToDelete);
  const oldTimer = uploadedFileCleanupTimers.get(key);
  if (oldTimer) clearTimeout(oldTimer);

  const normalizedDelay = Math.max(1_000, delayMs);
  const timer = setTimeout(() => {
    uploadedFileCleanupTimers.delete(key);
    void (async () => {
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(key, { force: true });
      } catch {}
    })();
  }, normalizedDelay);
  uploadedFileCleanupTimers.set(key, timer);
  return normalizedDelay;
}

async function fileExists(fs: FsPromisesModule, path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveConflictTargetPath(
  fs: FsPromisesModule,
  targetDir: string,
  fileName: string,
  policy: UploadConflictPolicy,
): Promise<string> {
  const basePath = resolve(targetDir, fileName);
  if (policy === "overwrite") return basePath;

  const exists = await fileExists(fs, basePath);
  if (!exists) return basePath;
  if (policy === "error") {
    throw new Error(`target already exists: ${fileName}`);
  }

  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  for (let i = 1; i <= 1000; i += 1) {
    const candidateName = `${stem} (${i})${ext}`;
    const candidatePath = resolve(targetDir, candidateName);
    if (!(await fileExists(fs, candidatePath))) return candidatePath;
  }
  throw new Error(`failed to resolve conflict path: ${fileName}`);
}

function cleanupExpiredUploadSessions(): void {
  const deadline = nowMs() - Math.max(60_000, UPLOAD_SESSION_TTL_MS);
  for (const [id, session] of uploadSessions.entries()) {
    if (session.updatedAt >= deadline) continue;
    void (async () => {
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(session.tempPath, { force: true });
      } catch {}
      uploadSessions.delete(id);
    })();
  }
}

function touchUploadSession(session: UploadSession): void {
  session.updatedAt = nowMs();
}

function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
}

function guessMimeTypeByExtension(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".md":
    case ".json":
    case ".yaml":
    case ".yml":
    case ".log":
    case ".csv":
      return "text/plain";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function summarizeDirectory(fs: FsPromisesModule, dirPath: string): Promise<DirectorySummary> {
  const startedAt = Date.now();
  const queue: Array<{ path: string; depth: number }> = [{ path: dirPath, depth: 0 }];
  let scannedNodes = 0;
  let fileCount = 0;
  let totalSizeBytes = 0;

  while (queue.length > 0) {
    if ((Date.now() - startedAt) > LS_DIR_SUMMARY_TIMEOUT_MS || scannedNodes > LS_DIR_SUMMARY_MAX_NODES) {
      return { fileCount, totalSizeBytes, partial: true };
    }
    const current = queue.pop()!;
    let children: Dirent[];
    try {
      children = await fs.readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const child of children) {
      scannedNodes++;
      if ((Date.now() - startedAt) > LS_DIR_SUMMARY_TIMEOUT_MS || scannedNodes > LS_DIR_SUMMARY_MAX_NODES) {
        return { fileCount, totalSizeBytes, partial: true };
      }

      const childPath = resolve(current.path, child.name);
      if (child.isSymbolicLink()) continue;

      if (child.isDirectory()) {
        if (current.depth < LS_DIR_SUMMARY_MAX_DEPTH) {
          queue.push({ path: childPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (child.isFile()) {
        try {
          const st = await fs.stat(childPath);
          const size = normalizeNumber(st.size);
          if (size !== null) {
            fileCount += 1;
            totalSizeBytes += size;
          }
        } catch {
          // ignore broken/unreadable file
        }
        continue;
      }

      try {
        const st = await fs.stat(childPath);
        if (st.isFile()) {
          const size = normalizeNumber(st.size);
          if (size !== null) {
            fileCount += 1;
            totalSizeBytes += size;
          }
        }
      } catch {
        // ignore unknown node type failure
      }
    }
  }

  return { fileCount, totalSizeBytes, partial: false };
}

// ── 路径安全工具 ──

export function resolveRpcRoot(value?: string): string | null {
  if (!value) return null;
  return resolve(value);
}

export function resolveRpcPath(inputPath: string, root: string | null): string {
  if (root && !isAbsolute(inputPath)) return resolve(root, inputPath);
  return resolve(inputPath);
}

export function assertPathAllowed(targetPath: string, root: string | null): void {
  if (!root) return;
  if (targetPath === root) return;
  if (!targetPath.startsWith(root + sep)) {
    throw new Error(`path outside rpc root: ${targetPath}`);
  }
}

// ── 内置 Handler 工厂 ──

export function createBuiltinHandlers(): Record<string, RpcHandlerMeta> {
  return {
    // ── 读操作 ──

    foreground_probe: {
      write: false,
      handler: async (_params, ctx) => {
        const probe = ctx.getForegroundProbe?.() ?? {};
        return {
          serverTs: Date.now(),
          ...probe,
        };
      },
    },

    get_execution_mode: {
      write: false,
      handler: async (_params, ctx) => {
        return {
          mode: ctx.getExecutionMode?.() ?? "act",
        };
      },
    },

    set_execution_mode: {
      write: true,
      handler: async (params, ctx) => {
        const raw = String(params.mode || "").trim().toLowerCase();
        if (raw !== "act" && raw !== "plan") throw new Error("mode must be act|plan");
        const result = await ctx.setExecutionMode?.(raw as "act" | "plan", "app");
        return {
          mode: raw,
          message: typeof result === "string" ? result : `mode switched to ${raw}`,
        };
      },
    },

    get_permission_mode: {
      write: false,
      handler: async (_params, ctx) => {
        return {
          mode: ctx.getPermissionMode?.() ?? "default",
        };
      },
    },

    set_permission_mode: {
      write: true,
      handler: async (params, ctx) => {
        const raw = String(params.mode || "").trim();
        const normalized = raw as "default" | "acceptEdits" | "yolo" | "readonly";
        if (!["default", "acceptEdits", "yolo", "readonly"].includes(normalized)) {
          throw new Error("mode must be default|acceptEdits|yolo|readonly");
        }
        if (!ctx.setPermissionMode) throw new Error("set permission mode unavailable");
        const message = await ctx.setPermissionMode(normalized);
        return {
          mode: normalized,
          message: typeof message === "string" ? message : `permission mode switched to ${normalized}`,
        };
      },
    },

    list_checkpoints: {
      write: false,
      handler: async (params, ctx) => {
        const limitRaw = normalizeNumber(params.limit);
        const limit = limitRaw && limitRaw > 0 ? Math.min(100, limitRaw) : 20;
        const items = ctx.listCheckpoints?.(limit) ?? [];
        return { items };
      },
    },

    restore_checkpoint: {
      write: true,
      handler: async (params, ctx) => {
        const id = String(params.id || "").trim();
        if (!id) throw new Error("id is required");
        if (!ctx.restoreCheckpoint) throw new Error("restore checkpoint unavailable");
        return await ctx.restoreCheckpoint(id);
      },
    },

    task_panel: {
      write: false,
      handler: async (_params, ctx) => {
        return ctx.getTaskPanel?.() ?? {
          running: [],
          runningCount: 0,
          queueSize: 0,
        };
      },
    },

    context_usage: {
      write: false,
      handler: async (_params, ctx) => {
        return ctx.getContextUsage?.() ?? {
          usedPercentage: 0,
          estimatedUsedTokens: 0,
          contextWindowSize: 200_000,
          runningTasks: 0,
        };
      },
    },

    compact_context: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.compactContext) throw new Error("compact context unavailable");
        const instructions = typeof params.instructions === "string" ? params.instructions.trim() : "";
        return await ctx.compactContext(instructions || undefined);
      },
    },

    rewind_preview: {
      write: false,
      handler: async (params, ctx) => {
        const target = String(
          params.target || params.id || params.promptId || params.prompt_id || params.checkpointId || "",
        ).trim();
        if (!target) throw new Error("target is required");
        if (!ctx.rewindPreview) throw new Error("rewind preview unavailable");
        return ctx.rewindPreview(target);
      },
    },

    rewind_to_message: {
      write: true,
      handler: async (params, ctx) => {
        const target = String(
          params.target || params.id || params.promptId || params.prompt_id || params.checkpointId || "",
        ).trim();
        if (!target) throw new Error("target is required");
        if (!ctx.rewindToMessage) throw new Error("rewind unavailable");
        const dryRun = normalizeBoolean(params.dryRun) ?? normalizeBoolean(params["dry-run"]) ?? false;
        return await ctx.rewindToMessage(target, dryRun);
      },
    },

    list_tasks: {
      write: false,
      handler: async (params, ctx) => {
        const limitRaw = normalizeNumber(params.limit);
        const limit = limitRaw && limitRaw > 0 ? Math.min(100, limitRaw) : 30;
        return {
          items: ctx.listTasks?.(limit) ?? [],
        };
      },
    },

    task_output: {
      write: false,
      handler: async (params, ctx) => {
        const taskId = String(params.taskId || params.task_id || "").trim();
        if (!taskId) throw new Error("taskId is required");
        if (!ctx.getTaskOutput) throw new Error("task output unavailable");
        const item = ctx.getTaskOutput(taskId);
        if (!item) throw new Error(`task not found: ${taskId}`);
        return item;
      },
    },

    stop_task: {
      write: true,
      handler: async (params, ctx) => {
        const taskId = String(params.taskId || params.task_id || "").trim();
        if (!taskId) throw new Error("taskId is required");
        if (!ctx.stopTask) throw new Error("task stop unavailable");
        const stopped = ctx.stopTask(taskId);
        return { taskId, stopped };
      },
    },

    memory_status: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.getMemoryStatus) throw new Error("memory center unavailable");
        return ctx.getMemoryStatus();
      },
    },

    memory_toggle: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.setMemoryEnabled) throw new Error("memory center unavailable");
        const enabled = normalizeBoolean(params.enabled);
        if (enabled === null) throw new Error("enabled must be boolean");
        const saved = ctx.setMemoryEnabled(enabled);
        return { enabled: saved };
      },
    },

    memory_add_note: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.addMemoryNote) throw new Error("memory center unavailable");
        const note = String(params.note || "").trim();
        if (!note) throw new Error("note is required");
        const topic = typeof params.topic === "string" ? params.topic.trim() : undefined;
        return ctx.addMemoryNote(note, topic);
      },
    },

    list_agents: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.listAgents) throw new Error("agent config unavailable");
        return { items: ctx.listAgents() };
      },
    },

    save_agent: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.saveAgent) throw new Error("agent config unavailable");
        const name = String(params.name || "").trim();
        const prompt = String(params.prompt || "").trim();
        if (!name) throw new Error("name is required");
        if (!prompt) throw new Error("prompt is required");
        const normalizeStrList = (value: unknown): string[] => {
          if (!Array.isArray(value)) return [];
          return value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
        };
        const agentInput: Record<string, unknown> = {
          name,
          description: String(params.description || "").trim() || "(no description)",
          prompt,
          tools: normalizeStrList(params.tools),
          disallowedTools: normalizeStrList(params.disallowedTools),
        };
        for (const key of ["model", "permissionMode", "memory", "background", "isolation", "maxTurns"] as const) {
          const value = params[key];
          if (value !== undefined) agentInput[key] = value;
        }
        return ctx.saveAgent(agentInput);
      },
    },

    delete_agent: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.deleteAgent) throw new Error("agent config unavailable");
        const name = String(params.name || "").trim();
        if (!name) throw new Error("name is required");
        return { name, deleted: ctx.deleteAgent(name) };
      },
    },

    get_permissions: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.getPermissionRules) throw new Error("permission policy unavailable");
        return ctx.getPermissionRules();
      },
    },

    set_permissions: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.setPermissionRules) throw new Error("permission policy unavailable");
        const normalizeList = (value: unknown): string[] => {
          if (!Array.isArray(value)) return [];
          return value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
        };
        return ctx.setPermissionRules({
          allow: normalizeList(params.allow),
          ask: normalizeList(params.ask),
          deny: normalizeList(params.deny),
        });
      },
    },

    get_sandbox_policy: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.getSandboxPolicy) throw new Error("sandbox policy unavailable");
        return ctx.getSandboxPolicy();
      },
    },

    set_sandbox_policy: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.setSandboxPolicy) throw new Error("sandbox policy unavailable");
        const normalizeList = (value: unknown): string[] => {
          if (!Array.isArray(value)) return [];
          return value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
        };
        const payload: Record<string, unknown> = {};
        const enabled = normalizeBoolean(params.enabled);
        if (enabled !== null) payload.enabled = enabled;
        const allowUnsandboxedCommands = normalizeBoolean(params.allowUnsandboxedCommands);
        if (allowUnsandboxedCommands !== null) payload.allowUnsandboxedCommands = allowUnsandboxedCommands;
        payload.allowedDomains = normalizeList(params.allowedDomains);
        payload.allowWrite = normalizeList(params.allowWrite);
        payload.denyWrite = normalizeList(params.denyWrite);
        payload.denyRead = normalizeList(params.denyRead);
        return ctx.setSandboxPolicy(payload);
      },
    },

    list_output_styles: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.listOutputStyles) throw new Error("output style unavailable");
        return { items: ctx.listOutputStyles() };
      },
    },

    get_output_style: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.getOutputStyle) throw new Error("output style unavailable");
        return ctx.getOutputStyle();
      },
    },

    set_output_style: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.setOutputStyle) throw new Error("output style unavailable");
        const styleId = String(params.styleId || params.id || "").trim();
        if (!styleId) throw new Error("styleId is required");
        return ctx.setOutputStyle(styleId);
      },
    },

    get_statusline: {
      write: false,
      handler: async (_params, ctx) => {
        if (!ctx.getStatusline) throw new Error("statusline unavailable");
        const text = await ctx.getStatusline();
        return { text };
      },
    },

    set_statusline: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.setStatusline) throw new Error("statusline unavailable");
        const input: { enabled?: boolean; command?: string } = {};
        const enabled = normalizeBoolean(params.enabled);
        if (enabled !== null) input.enabled = enabled;
        if (typeof params.command === "string") input.command = params.command.trim();
        return ctx.setStatusline(input);
      },
    },

    invoke_skill: {
      write: true,
      handler: async (params, ctx) => {
        if (!ctx.invokeSkill) throw new Error("skill invoke unavailable");
        const name = String(params.name || params.skill || "").trim();
        if (!name) throw new Error("skill name is required");
        const args = typeof params.args === "string"
          ? params.args
          : Array.isArray(params.args)
            ? params.args.map((item) => String(item)).join(" ")
            : "";
        return await ctx.invokeSkill(name, args.trim());
      },
    },

    skill_install_prepare: {
      write: true,
      handler: async (params, ctx) => {
        const sourceRaw = String(params.source || params.repo || params.url || "").trim();
        if (!sourceRaw) {
          throw Object.assign(new Error("source is required"), {
            code: "SKILL_INSTALL_SOURCE_REQUIRED",
          });
        }
        const scopeRaw = String(params.scope || "project").trim().toLowerCase();
        const scope = scopeRaw === "user" ? "user" : "project";
        let source = sourceRaw;
        if (!isLikelyRemoteSource(sourceRaw)) {
          const resolved = resolveRpcPath(sourceRaw, ctx.security.root);
          assertPathAllowed(resolved, ctx.security.root);
          source = resolved;
        }
        if (ctx.skillInstallPrepare) {
          return await ctx.skillInstallPrepare({ source, scope });
        }
        return await skillInstallPrepare({ source, scope });
      },
    },

    skill_install_status: {
      write: false,
      handler: async (params, ctx) => {
        const installId = String(params.installId || params.id || "").trim();
        if (!installId) {
          throw Object.assign(new Error("installId is required"), {
            code: "SKILL_INSTALL_INSTALL_ID_REQUIRED",
          });
        }
        if (ctx.skillInstallStatus) {
          return await ctx.skillInstallStatus({ installId });
        }
        const status = await skillInstallStatus(installId);
        if (!status) {
          throw Object.assign(new Error(`install session not found: ${installId}`), {
            code: "SKILL_INSTALL_SESSION_NOT_FOUND",
          });
        }
        return status;
      },
    },

    skill_install_cancel: {
      write: true,
      handler: async (params, ctx) => {
        const installId = String(params.installId || params.id || "").trim();
        if (!installId) {
          throw Object.assign(new Error("installId is required"), {
            code: "SKILL_INSTALL_INSTALL_ID_REQUIRED",
          });
        }
        if (ctx.skillInstallCancel) {
          return await ctx.skillInstallCancel({ installId });
        }
        return await skillInstallCancel(installId);
      },
    },

    skill_install_commit: {
      write: true,
      handler: async (params, ctx) => {
        const installId = String(params.installId || params.id || "").trim();
        if (!installId) {
          throw Object.assign(new Error("installId is required"), {
            code: "SKILL_INSTALL_INSTALL_ID_REQUIRED",
          });
        }
        const selected = Array.isArray(params.selected)
          ? params.selected.map((item) => String(item))
          : typeof params.selected === "string"
            ? params.selected
            : undefined;
        const force = normalizeBoolean(params.force) ?? false;
        const conflictPolicy = typeof params.conflictPolicy === "string"
          ? params.conflictPolicy.trim().toLowerCase()
          : undefined;
        if (ctx.skillInstallCommit) {
          return await ctx.skillInstallCommit({
            installId,
            selected,
            force,
            conflictPolicy: conflictPolicy === "overwrite" || conflictPolicy === "rename" || conflictPolicy === "skip"
              ? conflictPolicy
              : undefined,
          });
        }
        return await skillInstallCommit({
          installId,
          selected,
          force,
          conflictPolicy: conflictPolicy === "overwrite" || conflictPolicy === "rename" || conflictPolicy === "skip"
            ? conflictPolicy
            : undefined,
        });
      },
    },

    ls: {
      write: false,
      handler: async (params, ctx) => {
        const dir = (params.path as string) || ".";
        const resolved = resolveRpcPath(dir, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const fs = await import("node:fs/promises");
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        return mapWithConcurrency(entries, LS_META_CONCURRENCY, async (entry) => {
          const fullPath = resolve(resolved, entry.name);
          let st: import("node:fs").Stats | null = null;
          try {
            st = await fs.stat(fullPath);
          } catch {
            st = null;
          }

          const modifiedAtMs = st ? normalizeNumber(st.mtimeMs) : null;
          if (!entry.isDirectory()) {
            const sizeBytes = st ? normalizeNumber(st.size) : null;
            return {
              name: entry.name,
              isDir: false,
              sizeBytes,
              modifiedAtMs,
              fileCount: null,
              totalSizeBytes: null,
              summaryPartial: false,
            };
          }

          const summary = await summarizeDirectory(fs, fullPath);
          return {
            name: entry.name,
            isDir: true,
            sizeBytes: null,
            modifiedAtMs,
            fileCount: summary.fileCount,
            totalSizeBytes: summary.totalSizeBytes,
            summaryPartial: summary.partial,
          };
        });
      },
    },

    list_dirs: {
      write: false,
      handler: async (params, ctx) => {
        const fs = await import("node:fs/promises");
        const dirInput = (params.path as string) || ".";
        const resolved = resolveRpcPath(dirInput, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        return listDirectories(fs, resolved);
      },
    },

    grep: {
      write: false,
      handler: async (params, ctx) => {
        const { pattern, path: gPath } = params as { pattern: string; path?: string };
        const resolved = resolveRpcPath(gPath || (ctx.security.root ?? "."), ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const proc = Bun.spawn(["rg", "--json", "-m", "20", pattern, resolved], {
          stdout: "pipe", stderr: "pipe",
        });
        const out = await new Response(proc.stdout).text();
        return out.split("\n").filter(Boolean).slice(0, 20);
      },
    },

    git_status: {
      write: false,
      handler: async () => {
        const proc = Bun.spawn(["git", "status", "--porcelain"], { stdout: "pipe" });
        return (await new Response(proc.stdout).text()).trim().split("\n").filter(Boolean);
      },
    },

    git_log: {
      write: false,
      handler: async () => {
        const proc = Bun.spawn(["git", "log", "--oneline", "-10"], { stdout: "pipe" });
        return (await new Response(proc.stdout).text()).trim().split("\n");
      },
    },

    read_file: {
      write: false,
      handler: async (params, ctx) => {
        const p = params.path as string;
        const resolved = resolveRpcPath(p, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        return await Bun.file(resolved).text();
      },
    },

    download_file: {
      write: false,
      handler: async (params, ctx) => {
        const p = params.path as string;
        const resolved = resolveRpcPath(p, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const fs = await import("node:fs/promises");
        const st = await fs.stat(resolved);
        const sizeBytes = normalizeNumber(st.size) ?? 0;
        if (sizeBytes > DOWNLOAD_MAX_BYTES) {
          throw new Error(`file too large: ${sizeBytes} bytes > ${DOWNLOAD_MAX_BYTES}`);
        }
        const bytes = await fs.readFile(resolved);
        const fileName = basename(resolved);
        const mimeType = normalizeMimeType(params.mimeType) ?? guessMimeTypeByExtension(fileName);
        return {
          path: resolved,
          fileName,
          sizeBytes,
          mimeType,
          contentBase64: Buffer.from(bytes).toString("base64"),
        };
      },
    },

    list_templates: {
      write: false,
      handler: async () => loadTemplates(),
    },

    list_projects: {
      write: false,
      handler: async () => loadProjectList(),
    },

    // ── 写操作 ──

    write_file: {
      write: true,
      handler: async (params, ctx) => {
        const { path: wPath, content } = params as { path: string; content: string };
        const resolved = resolveRpcPath(wPath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        await Bun.write(resolved, content);
        return { written: true, path: resolved };
      },
    },

    upload_init: {
      write: true,
      handler: async (params, ctx) => {
        cleanupExpiredUploadSessions();
        const fs = await import("node:fs/promises");
        const targetDirInput = (params.targetDir as string) || ".";
        const rawFileName = (params.fileName as string) || "upload.bin";
        const totalBytes = normalizeNumber(params.totalBytes);
        const mimeType = normalizeMimeType(params.mimeType);
        const policy = normalizeConflictPolicy(params.conflictPolicy);
        const requestedUploadId = typeof params.uploadId === "string" && params.uploadId.trim().length > 0
          ? params.uploadId.trim()
          : null;

        const targetDir = resolveRpcPath(targetDirInput, ctx.security.root);
        assertPathAllowed(targetDir, ctx.security.root);
        await fs.mkdir(targetDir, { recursive: true });

        if (requestedUploadId) {
          const existing = uploadSessions.get(requestedUploadId);
          if (existing) {
            assertPathAllowed(existing.targetPath, ctx.security.root);
            assertPathAllowed(existing.tempPath, null);
            touchUploadSession(existing);
            return {
              uploadId: existing.id,
              nextOffset: existing.receivedBytes,
              fileName: existing.fileName,
              targetPath: existing.targetPath,
              resumed: true,
            };
          }
        }

        const fileName = sanitizeFileName(rawFileName);
        const targetPath = await resolveConflictTargetPath(fs, targetDir, fileName, policy);
        const uploadId = requestedUploadId || crypto.randomUUID();
        const tempPath = resolve(tmpdir(), `.yuanio-upload-${uploadId}.part`);
        await fs.mkdir(dirname(tempPath), { recursive: true });
        await fs.writeFile(tempPath, new Uint8Array(0));

        const session: UploadSession = {
          id: uploadId,
          tempPath,
          targetPath,
          fileName: basename(targetPath),
          receivedBytes: 0,
          totalBytes,
          mimeType,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        };
        uploadSessions.set(uploadId, session);

        return {
          uploadId,
          nextOffset: 0,
          fileName: session.fileName,
          targetPath,
          resumed: false,
        };
      },
    },

    upload_chunk: {
      write: true,
      handler: async (params) => {
        cleanupExpiredUploadSessions();
        const uploadId = typeof params.uploadId === "string" ? params.uploadId : "";
        const chunkBase64 = typeof params.chunkBase64 === "string" ? params.chunkBase64 : "";
        const offset = normalizeNumber(params.offset) ?? 0;
        if (!uploadId) throw new Error("uploadId is required");
        if (!chunkBase64) throw new Error("chunkBase64 is required");

        const session = uploadSessions.get(uploadId);
        if (!session) throw new Error(`upload session not found: ${uploadId}`);

        if (offset < session.receivedBytes) {
          touchUploadSession(session);
          return {
            uploadId,
            accepted: false,
            nextOffset: session.receivedBytes,
            reason: "offset_behind",
          };
        }
        if (offset > session.receivedBytes) {
          touchUploadSession(session);
          return {
            uploadId,
            accepted: false,
            nextOffset: session.receivedBytes,
            reason: "offset_ahead",
          };
        }

        const chunk = Buffer.from(chunkBase64, "base64");
        if (chunk.length === 0) {
          touchUploadSession(session);
          return { uploadId, accepted: true, nextOffset: session.receivedBytes, chunkBytes: 0 };
        }

        const fs = await import("node:fs/promises");
        await fs.appendFile(session.tempPath, chunk);
        session.receivedBytes += chunk.length;
        touchUploadSession(session);
        return {
          uploadId,
          accepted: true,
          nextOffset: session.receivedBytes,
          chunkBytes: chunk.length,
        };
      },
    },

    upload_commit: {
      write: true,
      handler: async (params, ctx) => {
        cleanupExpiredUploadSessions();
        const uploadId = typeof params.uploadId === "string" ? params.uploadId : "";
        if (!uploadId) throw new Error("uploadId is required");
        const session = uploadSessions.get(uploadId);
        if (!session) throw new Error(`upload session not found: ${uploadId}`);

        assertPathAllowed(session.targetPath, ctx.security.root);
        const fs = await import("node:fs/promises");
        if (session.totalBytes !== null && session.receivedBytes !== session.totalBytes) {
          return {
            uploadId,
            committed: false,
            reason: "size_mismatch",
            expectedBytes: session.totalBytes,
            receivedBytes: session.receivedBytes,
            nextOffset: session.receivedBytes,
          };
        }

        await fs.mkdir(dirname(session.targetPath), { recursive: true });
        await fs.copyFile(session.tempPath, session.targetPath);
        await fs.rm(session.tempPath, { force: true });
        uploadSessions.delete(uploadId);

        const refPath = toPromptRefPath(session.targetPath, process.cwd());
        const promptText = typeof params.promptText === "string" ? params.promptText : "";
        const suggestedPrompt = buildUploadPrompt(refPath, promptText);
        const explicitCleanupDelay = normalizeCleanupDelay(params.cleanupAfterMs);
        const cleanupDelay = explicitCleanupDelay
          ?? (params.ephemeral === true ? Math.max(1_000, UPLOAD_SUBMITTED_FILE_TTL_MS) : null);
        const cleanupScheduledMs = cleanupDelay
          ? scheduleUploadedFileCleanup(session.targetPath, cleanupDelay)
          : null;

        return {
          uploadId,
          committed: true,
          path: session.targetPath,
          fileName: session.fileName,
          sizeBytes: session.receivedBytes,
          mimeType: session.mimeType,
          atPath: refPath,
          promptRef: `@${refPath}`,
          suggestedPrompt,
          cleanupScheduledMs,
        };
      },
    },

    upload_abort: {
      write: true,
      handler: async (params) => {
        const uploadId = typeof params.uploadId === "string" ? params.uploadId : "";
        if (!uploadId) throw new Error("uploadId is required");
        const session = uploadSessions.get(uploadId);
        if (!session) return { uploadId, aborted: true, existed: false };

        const fs = await import("node:fs/promises");
        await fs.rm(session.tempPath, { force: true });
        uploadSessions.delete(uploadId);
        return { uploadId, aborted: true, existed: true };
      },
    },

    mkdir: {
      write: true,
      handler: async (params, ctx) => {
        const dir = params.path as string;
        const resolved = resolveRpcPath(dir, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const fs = await import("node:fs/promises");
        await fs.mkdir(resolved, { recursive: true });
        return { created: true, path: resolved };
      },
    },

    delete: {
      write: true,
      handler: async (params, ctx) => {
        const dPath = params.path as string;
        const resolved = resolveRpcPath(dPath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const fs = await import("node:fs/promises");
        await fs.rm(resolved, { recursive: true });
        return { deleted: true, path: resolved };
      },
    },

    rename: {
      write: true,
      handler: async (params, ctx) => {
        const { from, to } = params as { from: string; to: string };
        const fromResolved = resolveRpcPath(from, ctx.security.root);
        const toResolved = resolveRpcPath(to, ctx.security.root);
        assertPathAllowed(fromResolved, ctx.security.root);
        assertPathAllowed(toResolved, ctx.security.root);
        const fs = await import("node:fs/promises");
        await fs.rename(fromResolved, toResolved);
        return { renamed: true, from: fromResolved, to: toResolved };
      },
    },

    save_template: {
      write: true,
      handler: async (params) => {
        const { name, content } = params as { name: string; content: string };
        saveTemplate(name, content);
        return { saved: true, name };
      },
    },

    delete_template: {
      write: true,
      handler: async (params) => {
        const name = params.name as string;
        deleteTemplate(name);
        return { deleted: true, name };
      },
    },

    add_project: {
      write: true,
      handler: async (params, ctx) => {
        const { path: pPath, name: pName } = params as { path: string; name?: string };
        const resolved = resolveRpcPath(pPath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        return addProject(resolved, pName);
      },
    },

    remove_project: {
      write: true,
      handler: async (params, ctx) => {
        const pPath = params.path as string;
        const resolved = resolveRpcPath(pPath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        return { removed: removeProject(resolved) };
      },
    },

    switch_project: {
      write: true,
      handler: async (params, ctx) => {
        const projPath = params.path as string;
        const resolved = resolveRpcPath(projPath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        process.chdir(resolved);
        addProject(resolved);
        if (ctx.onProjectSwitched) {
          await ctx.onProjectSwitched(resolved);
        }
        return { switched: true, path: resolved, name: basename(resolved) };
      },
    },

    change_cwd: {
      write: true,
      handler: async (params, ctx) => {
        const fs = await import("node:fs/promises");
        const raw = params.path as string;
        if (!raw || typeof raw !== "string") throw new Error("path is required");
        const resolved = resolveRpcPath(raw, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const cwd = await assertDirectoryPath(fs, resolved);
        process.chdir(cwd);
        addProject(cwd);
        if (ctx.onProjectSwitched) {
          await ctx.onProjectSwitched(cwd);
        }
        const browser = await listDirectories(fs, cwd);
        return {
          changed: true,
          ...browser,
        };
      },
    },

    // ── Phase 6: 消息历史 ──

    message_history: {
      write: false,
      handler: async (params) => {
        const { sessionId, limit, beforeSeq } = params as {
          sessionId: string; limit?: number; beforeSeq?: number;
        };
        // 延迟获取 DB 实例（daemon 进程中初始化）
        const { Database } = await import("bun:sqlite");
        const YUANIO_DIR = `${process.env.HOME || process.env.USERPROFILE}/.yuanio`;
        const db = new Database(`${YUANIO_DIR}/cache.db`);
        const store = new MessageStore(db);
        const rows = store.getMessages(sessionId, limit ?? 50, beforeSeq);
        const messages = rows.reverse();
        const nextBeforeSeq = rows.length > 0 ? rows[0].seq : null;
        return {
          messages: messages.map((m) => ({
            id: m.id, seq: m.seq, content: JSON.parse(m.content), role: m.role, createdAt: m.createdAt,
          })),
          page: { limit: limit ?? 50, beforeSeq: beforeSeq ?? null, nextBeforeSeq, hasMore: rows.length >= (limit ?? 50) },
        };
      },
    },

    // ── Phase 11: Git Diff 细粒度 ──

    git_diff_numstat: {
      write: false,
      handler: async () => {
        const proc = Bun.spawn(["git", "diff", "--numstat"], { stdout: "pipe" });
        const out = await new Response(proc.stdout).text();
        return out.trim().split("\n").filter(Boolean).map((line) => {
          const [added, removed, file] = line.split("\t");
          return { added: Number(added), removed: Number(removed), file };
        });
      },
    },

    git_diff_file: {
      write: false,
      handler: async (params, ctx) => {
        const filePath = params.path as string;
        const resolved = resolveRpcPath(filePath, ctx.security.root);
        assertPathAllowed(resolved, ctx.security.root);
        const proc = Bun.spawn(["git", "diff", "--", resolved], { stdout: "pipe" });
        return await new Response(proc.stdout).text();
      },
    },

    git_diff_staged: {
      write: false,
      handler: async () => {
        const proc = Bun.spawn(["git", "diff", "--staged", "--numstat"], { stdout: "pipe" });
        const out = await new Response(proc.stdout).text();
        return out.trim().split("\n").filter(Boolean).map((line) => {
          const [added, removed, file] = line.split("\t");
          return { added: Number(added), removed: Number(removed), file };
        });
      },
    },

    // ── Phase 11: Slash Commands / Skills 发现 ──

    list_slash_commands: {
      write: false,
      handler: async (_params, ctx) => {
        const fromCtx = ctx.listSlashCommands?.();
        if (fromCtx) return fromCtx;
        return listSlashCommandFiles();
      },
    },

    list_skills: {
      write: false,
      handler: async (_params, ctx) => {
        const fromCtx = ctx.listSkills?.();
        if (fromCtx) return fromCtx;
        return discoverSkills().map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          source: item.source,
          scope: item.scope,
          userInvocable: item.userInvocable,
          context: item.context,
          disableModelInvocation: item.disableModelInvocation,
          argumentHint: item.argumentHint || null,
          path: item.path,
        }));
      },
    },

    // ── Shell 回退模式 ──

    shell_exec: {
      write: true,
      handler: async (params, ctx) => {
        const cmd = params.command as string;
        if (!cmd || typeof cmd !== "string") throw new Error("command is required");
        const dryRun = normalizeBoolean(params.dryRun) === true;
        const confirmed = normalizeBoolean(params.confirmed) === true;
        const safety = evaluateCommandSafety(cmd, { confirmed });
        if (dryRun) {
          return {
            dryRun: true,
            command: cmd,
            safety,
          };
        }
        if (safety.decision === "forbidden") {
          throw new Error(`shell_exec blocked: ${safety.justification || "command forbidden by safety policy"}`);
        }
        if (safety.requiresConfirmation) {
          return {
            blocked: true,
            requiresConfirmation: true,
            command: cmd,
            safety,
            message: safety.justification || "该命令需要确认后再执行（请带 confirmed=true 重试）",
          };
        }
        const cwd = ctx.security.root ?? process.cwd();
        const proc = Bun.spawn(["sh", "-c", cmd], {
          stdout: "pipe",
          stderr: "pipe",
          cwd,
          env: { ...process.env, TERM: "dumb" },
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        // 截断过长输出
        const maxLen = 8000;
        return {
          stdout: stdout.length > maxLen ? stdout.slice(0, maxLen) + "\n…(truncated)" : stdout,
          stderr: stderr.length > maxLen ? stderr.slice(0, maxLen) + "\n…(truncated)" : stderr,
          exitCode,
          cwd,
          safety,
        };
      },
    },
    // ── 内部命令转发 ──

    agent_command: {
      write: false,
      handler: async (params) => {
        const cmd = (params.command as string || "").trim().toLowerCase();
        if (!cmd) throw new Error("command is required");

        switch (cmd) {
          case "/cwd":
            return { output: process.cwd() };
          case "/uptime": {
            const sec = Math.floor(process.uptime());
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = sec % 60;
            return { output: `${h}h ${m}m ${s}s` };
          }
          case "/env": {
            const safe = ["NODE_ENV", "SHELL", "TERM", "LANG", "HOME", "USER"];
            const entries = safe
              .filter((k) => process.env[k])
              .map((k) => `${k}=${process.env[k]}`);
            return { output: entries.join("\n") || "(empty)" };
          }
          case "/mem": {
            const mem = process.memoryUsage();
            const mb = (v: number) => (v / 1024 / 1024).toFixed(1);
            return { output: `RSS: ${mb(mem.rss)}MB | Heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB` };
          }
          case "/pid":
            return { output: `PID: ${process.pid}` };
          default:
            return { output: `未知命令: ${cmd}\n可用: /cwd /uptime /env /mem /pid` };
        }
      },
    },
  };
}

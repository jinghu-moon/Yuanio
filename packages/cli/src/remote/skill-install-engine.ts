import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseSkillFile } from "./skill-engine";

type FsPromisesModule = typeof import("node:fs/promises");

export type SkillInstallScope = "project" | "user";
export type SkillInstallSourceKind = "local" | "git";
export type SkillConflictPolicy = "skip" | "overwrite" | "rename";
export type SkillInstallState = "prepared" | "committed" | "cancelled";
export type SkillInstallErrorCode =
  | "SKILL_INSTALL_SOURCE_REQUIRED"
  | "SKILL_INSTALL_SOURCE_NOT_FOUND"
  | "SKILL_INSTALL_GIT_CLONE_FAILED"
  | "SKILL_INSTALL_INSTALL_ID_REQUIRED"
  | "SKILL_INSTALL_SESSION_NOT_FOUND"
  | "SKILL_INSTALL_SESSION_NOT_PREPARED"
  | "SKILL_INSTALL_SELECTION_EMPTY"
  | "SKILL_INSTALL_RENAME_TARGET_EXHAUSTED"
  | "SKILL_INSTALL_INTERNAL";

export class SkillInstallError extends Error {
  code: SkillInstallErrorCode;
  status: number;

  constructor(code: SkillInstallErrorCode, message: string, status = 400) {
    super(message);
    this.name = "SkillInstallError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeSkillInstallError(error: unknown): {
  code: SkillInstallErrorCode | "SKILL_INSTALL_INTERNAL";
  message: string;
  status: number;
} {
  if (error instanceof SkillInstallError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  if (error instanceof Error) {
    return {
      code: "SKILL_INSTALL_INTERNAL",
      message: error.message || "skill install failed",
      status: 500,
    };
  }
  return {
    code: "SKILL_INSTALL_INTERNAL",
    message: String(error || "skill install failed"),
    status: 500,
  };
}

export interface SkillInstallCandidate {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: SkillInstallScope;
  valid: boolean;
  warnings: string[];
}

interface SkillInstallCandidateInternal extends SkillInstallCandidate {
  skillFile: string;
  sourceDir: string;
}

export interface SkillInstallSessionStatus {
  installId: string;
  state: SkillInstallState;
  source: string;
  sourceKind: SkillInstallSourceKind;
  scope: SkillInstallScope;
  createdAt: number;
  updatedAt: number;
  candidateCount: number;
  candidates: SkillInstallCandidate[];
  result: SkillInstallCommitResult | null;
}

export interface SkillInstallPrepareParams {
  source: string;
  scope?: SkillInstallScope | string;
  cwd?: string;
  homeDir?: string;
}

export interface SkillInstallPrepareResult {
  installId: string;
  source: string;
  sourceKind: SkillInstallSourceKind;
  scope: SkillInstallScope;
  createdAt: number;
  candidates: SkillInstallCandidate[];
}

export interface SkillInstallCommitParams {
  installId: string;
  selected?: string[] | string;
  force?: boolean;
  conflictPolicy?: SkillConflictPolicy | string;
  cwd?: string;
  homeDir?: string;
}

export interface SkillInstallRecord {
  id: string;
  name: string;
  path: string;
  targetPath: string;
  warning?: string;
}

export interface SkillInstallCommitResult {
  installId: string;
  scope: SkillInstallScope;
  targetRoot: string;
  installed: SkillInstallRecord[];
  skipped: SkillInstallRecord[];
  failed: Array<SkillInstallRecord & { error: string }>;
  total: number;
}

export interface SkillInstallCancelResult {
  installId: string;
  cancelled: boolean;
  existed: boolean;
}

interface SkillInstallSessionInternal {
  installId: string;
  source: string;
  sourceKind: SkillInstallSourceKind;
  sourceRoot: string;
  scope: SkillInstallScope;
  state: SkillInstallState;
  createdAt: number;
  updatedAt: number;
  candidates: SkillInstallCandidateInternal[];
  cleanupDirs: string[];
  result: SkillInstallCommitResult | null;
}

const SESSION_TTL_MS_RAW = Number(process.env.YUANIO_SKILL_INSTALL_SESSION_TTL_MS ?? 60 * 60 * 1000);
const SESSION_TTL_MS = Number.isFinite(SESSION_TTL_MS_RAW) ? Math.max(60_000, Math.floor(SESSION_TTL_MS_RAW)) : 60 * 60 * 1000;
const MAX_SCAN_NODES_RAW = Number(process.env.YUANIO_SKILL_INSTALL_SCAN_MAX_NODES ?? 8_000);
const MAX_SCAN_NODES = Number.isFinite(MAX_SCAN_NODES_RAW) ? Math.max(500, Math.floor(MAX_SCAN_NODES_RAW)) : 8_000;

const SKILL_SCAN_IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
const installSessions = new Map<string, SkillInstallSessionInternal>();
let installCommitQueue = Promise.resolve();

function fail(code: SkillInstallErrorCode, message: string, status = 400): never {
  throw new SkillInstallError(code, message, status);
}

function withInstallCommitMutex<T>(runner: () => Promise<T>): Promise<T> {
  const chain = installCommitQueue.then(runner, runner);
  installCommitQueue = chain.then(() => undefined, () => undefined);
  return chain;
}

function nowMs(): number {
  return Date.now();
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeScope(scope?: string): SkillInstallScope {
  return scope?.toLowerCase() === "user" ? "user" : "project";
}

function normalizeConflictPolicy(value: unknown, force?: boolean): SkillConflictPolicy {
  if (value === "skip" || value === "overwrite" || value === "rename") return value;
  if (force === true) return "overwrite";
  return "skip";
}

function normalizeSelected(selected: SkillInstallCommitParams["selected"]): string[] {
  if (Array.isArray(selected)) {
    return selected.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof selected === "string") {
    return selected.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toUnixRelativePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function sanitizeSkillDirName(name: string): string {
  const cleaned = name.trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "skill";
}

function isRemoteSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return true;
  if (trimmed.startsWith("git@")) return true;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return true; // owner/repo
  return false;
}

function normalizeGitSource(source: string): string {
  const trimmed = source.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  return trimmed;
}

function resolveProjectSkillRoot(cwd: string): string {
  return join(cwd, ".agents", "skills");
}

function resolveUserSkillRoot(homeDir: string): string {
  return join(homeDir, ".agents", "skills");
}

function resolveInstallTargetRoot(scope: SkillInstallScope, cwd: string, homeDir: string): string {
  return scope === "user" ? resolveUserSkillRoot(homeDir) : resolveProjectSkillRoot(cwd);
}

function shouldUseCandidate(candidate: SkillInstallCandidateInternal, selectors: Set<string>): boolean {
  if (selectors.size === 0 || selectors.has("all")) return true;
  const id = candidate.id.toLowerCase();
  const name = candidate.name.toLowerCase();
  const relPath = candidate.path.toLowerCase();
  return selectors.has(id) || selectors.has(name) || selectors.has(relPath);
}

function firstParagraph(text: string): string {
  return text
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) || "";
}

async function runGitClone(repoUrl: string, targetDir: string): Promise<void> {
  const proc = Bun.spawn(["git", "clone", "--depth", "1", "--", repoUrl, targetDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const reason = (stderr || stdout || `exit=${exitCode}`).trim();
    fail("SKILL_INSTALL_GIT_CLONE_FAILED", `git clone failed: ${reason}`, 400);
  }
}

async function cleanupDirs(dirs: string[]): Promise<void> {
  if (dirs.length === 0) return;
  const fs = await import("node:fs/promises");
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

async function cleanupExpiredSessions(): Promise<number> {
  const deadline = nowMs() - SESSION_TTL_MS;
  const expiredIds: string[] = [];
  for (const [installId, session] of installSessions.entries()) {
    if (session.updatedAt < deadline) {
      expiredIds.push(installId);
    }
  }
  for (const installId of expiredIds) {
    const hit = installSessions.get(installId);
    if (!hit) continue;
    installSessions.delete(installId);
    await cleanupDirs(hit.cleanupDirs);
  }
  return expiredIds.length;
}

async function resolveSourceRoot(params: SkillInstallPrepareParams): Promise<{
  sourceKind: SkillInstallSourceKind;
  sourceRoot: string;
  cleanupDirs: string[];
}> {
  const source = params.source.trim();
  if (!source) fail("SKILL_INSTALL_SOURCE_REQUIRED", "source is required", 400);

  const cwd = resolve(params.cwd || process.cwd());
  if (!isRemoteSource(source)) {
    const sourceRoot = resolve(cwd, source);
    const st = existsSync(sourceRoot) ? await (await import("node:fs/promises")).stat(sourceRoot).catch(() => null) : null;
    if (!st || !st.isDirectory()) {
      fail("SKILL_INSTALL_SOURCE_NOT_FOUND", `source directory not found: ${sourceRoot}`, 404);
    }
    return { sourceKind: "local", sourceRoot, cleanupDirs: [] };
  }

  const repoUrl = normalizeGitSource(source);
  const fs = await import("node:fs/promises");
  const tempParent = await fs.mkdtemp(join(tmpdir(), "yuanio-skill-src-"));
  const cloneTarget = join(tempParent, "repo");
  try {
    await runGitClone(repoUrl, cloneTarget);
  } catch (error) {
    await fs.rm(tempParent, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
  return {
    sourceKind: "git",
    sourceRoot: cloneTarget,
    cleanupDirs: [tempParent],
  };
}

async function scanSkillCandidates(sourceRoot: string, scope: SkillInstallScope): Promise<SkillInstallCandidateInternal[]> {
  const fs = await import("node:fs/promises");
  const stack = [resolve(sourceRoot)];
  const hits: SkillInstallCandidateInternal[] = [];
  let scannedNodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      scannedNodes += 1;
      if (scannedNodes > MAX_SCAN_NODES) {
        return hits;
      }

      if (entry.isSymbolicLink()) continue;
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKILL_SCAN_IGNORE_DIRS.has(entry.name.toLowerCase())) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name !== "SKILL.md") continue;

      const parsed = parseSkillFile(fullPath);
      const warnings: string[] = [];
      let name = basename(dirname(fullPath));
      let description = "(no description)";
      let valid = true;

      if (!parsed) {
        valid = false;
        warnings.push("parse_failed");
      } else {
        const fm = parsed.frontmatter;
        const fromName = typeof fm.name === "string" ? fm.name.trim() : "";
        const fromDescription = typeof fm.description === "string" ? fm.description.trim() : "";
        const fallbackDescription = firstParagraph(parsed.body);
        name = fromName || name;
        if (!name) {
          valid = false;
          warnings.push("missing_name");
          name = "unknown-skill";
        }
        if (fromDescription) {
          description = fromDescription;
        } else if (fallbackDescription) {
          description = fallbackDescription.slice(0, 120);
        } else {
          description = "(no description)";
          warnings.push("missing_description");
        }
      }

      const relativePath = toUnixRelativePath(sourceRoot, fullPath);
      const candidate: SkillInstallCandidateInternal = {
        id: `candidate_${hits.length + 1}`,
        name,
        description,
        path: relativePath,
        scope,
        valid,
        warnings,
        skillFile: fullPath,
        sourceDir: dirname(fullPath),
      };
      hits.push(candidate);
    }
  }

  return hits.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

async function copySkillDir(fs: FsPromisesModule, sourceDir: string, destDir: string): Promise<void> {
  await fs.mkdir(dirname(destDir), { recursive: true });
  await fs.cp(sourceDir, destDir, { recursive: true, force: true, errorOnExist: false });
}

async function findRenameTarget(fs: FsPromisesModule, targetRoot: string, baseName: string): Promise<string> {
  for (let i = 1; i <= 999; i += 1) {
    const candidate = join(targetRoot, `${baseName}-${i}`);
    const exists = await fs.stat(candidate).then(() => true).catch(() => false);
    if (!exists) return candidate;
  }
  fail("SKILL_INSTALL_RENAME_TARGET_EXHAUSTED", `failed to resolve rename target for ${baseName}`, 409);
}

async function installCandidateAtomically(
  fs: FsPromisesModule,
  candidate: SkillInstallCandidateInternal,
  targetRoot: string,
  policy: SkillConflictPolicy,
): Promise<{ type: "installed" | "skipped"; targetPath: string; warning?: string }> {
  const baseName = sanitizeSkillDirName(candidate.name);
  const defaultTarget = join(targetRoot, baseName);
  let finalTarget = defaultTarget;
  const targetExists = await fs.stat(defaultTarget).then(() => true).catch(() => false);
  if (targetExists && policy === "rename") {
    finalTarget = await findRenameTarget(fs, targetRoot, baseName);
  }
  if (targetExists && policy === "skip" && finalTarget === defaultTarget) {
    return { type: "skipped", targetPath: finalTarget, warning: "target_exists" };
  }

  const stageDir = join(targetRoot, `.${baseName}.stage-${Math.random().toString(36).slice(2, 8)}`);
  await fs.rm(stageDir, { recursive: true, force: true });
  await copySkillDir(fs, candidate.sourceDir, stageDir);

  let backupDir: string | null = null;
  try {
    const finalExists = await fs.stat(finalTarget).then(() => true).catch(() => false);
    if (finalExists) {
      if (policy === "overwrite") {
        backupDir = join(targetRoot, `.${baseName}.bak-${Math.random().toString(36).slice(2, 8)}`);
        await fs.rename(finalTarget, backupDir);
      } else if (policy === "skip") {
        await fs.rm(stageDir, { recursive: true, force: true });
        return { type: "skipped", targetPath: finalTarget, warning: "target_exists" };
      }
    }
    await fs.rename(stageDir, finalTarget);
    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true });
    }
    return { type: "installed", targetPath: finalTarget };
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => null);
    if (backupDir) {
      const restored = await fs.stat(finalTarget).then(() => false).catch(() => true);
      if (restored) {
        await fs.rename(backupDir, finalTarget).catch(() => null);
      }
    }
    throw error;
  }
}

function toPublicSession(session: SkillInstallSessionInternal): SkillInstallSessionStatus {
  return {
    installId: session.installId,
    state: session.state,
    source: session.source,
    sourceKind: session.sourceKind,
    scope: session.scope,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    candidateCount: session.candidates.length,
    candidates: session.candidates.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      path: item.path,
      scope: item.scope,
      valid: item.valid,
      warnings: [...item.warnings],
    })),
    result: session.result,
  };
}

export async function skillInstallPrepare(params: SkillInstallPrepareParams): Promise<SkillInstallPrepareResult> {
  await cleanupExpiredSessions();
  const source = String(params.source || "").trim();
  if (!source) fail("SKILL_INSTALL_SOURCE_REQUIRED", "source is required", 400);

  const scope = normalizeScope(params.scope);
  const { sourceKind, sourceRoot, cleanupDirs } = await resolveSourceRoot(params);
  const candidates = await scanSkillCandidates(sourceRoot, scope);
  const installId = randomId("install");
  const now = nowMs();

  const session: SkillInstallSessionInternal = {
    installId,
    source,
    sourceKind,
    sourceRoot,
    scope,
    state: "prepared",
    createdAt: now,
    updatedAt: now,
    candidates,
    cleanupDirs,
    result: null,
  };
  installSessions.set(installId, session);

  return {
    installId,
    source,
    sourceKind,
    scope,
    createdAt: now,
    candidates: toPublicSession(session).candidates,
  };
}

export async function skillInstallStatus(installId: string): Promise<SkillInstallSessionStatus | null> {
  await cleanupExpiredSessions();
  const hit = installSessions.get(String(installId || "").trim());
  if (!hit) return null;
  hit.updatedAt = nowMs();
  return toPublicSession(hit);
}

export async function skillInstallCancel(installId: string): Promise<SkillInstallCancelResult> {
  await cleanupExpiredSessions();
  const id = String(installId || "").trim();
  const hit = installSessions.get(id);
  if (!hit) {
    return { installId: id, cancelled: true, existed: false };
  }
  hit.state = "cancelled";
  hit.updatedAt = nowMs();
  installSessions.delete(id);
  await cleanupDirs(hit.cleanupDirs);
  return { installId: id, cancelled: true, existed: true };
}

export async function skillInstallCommit(params: SkillInstallCommitParams): Promise<SkillInstallCommitResult> {
  await cleanupExpiredSessions();
  const installId = String(params.installId || "").trim();
  if (!installId) fail("SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required", 400);

  return await withInstallCommitMutex(async () => {
    const session = installSessions.get(installId);
    if (!session) fail("SKILL_INSTALL_SESSION_NOT_FOUND", `install session not found: ${installId}`, 404);
    if (session.state !== "prepared") {
      fail("SKILL_INSTALL_SESSION_NOT_PREPARED", `install session not prepared: ${installId}`, 409);
    }

    const selectors = new Set(normalizeSelected(params.selected).map((item) => item.toLowerCase()));
    const selectedCandidates = session.candidates.filter((item) => shouldUseCandidate(item, selectors));
    if (selectedCandidates.length === 0) {
      fail("SKILL_INSTALL_SELECTION_EMPTY", "no skill candidate selected", 400);
    }

    const cwd = resolve(params.cwd || process.cwd());
    const homeDir = resolve(params.homeDir || homedir());
    const targetRoot = resolveInstallTargetRoot(session.scope, cwd, homeDir);
    const conflictPolicy = normalizeConflictPolicy(params.conflictPolicy, params.force);

    const fs = await import("node:fs/promises");
    await fs.mkdir(targetRoot, { recursive: true });

    const installed: SkillInstallRecord[] = [];
    const skipped: SkillInstallRecord[] = [];
    const failed: Array<SkillInstallRecord & { error: string }> = [];

    for (const candidate of selectedCandidates) {
      const recordBase: SkillInstallRecord = {
        id: candidate.id,
        name: candidate.name,
        path: candidate.path,
        targetPath: join(targetRoot, sanitizeSkillDirName(candidate.name)),
      };

      if (!candidate.valid) {
        failed.push({ ...recordBase, error: "candidate invalid" });
        continue;
      }

      try {
        const result = await installCandidateAtomically(fs, candidate, targetRoot, conflictPolicy);
        if (result.type === "skipped") {
          skipped.push({ ...recordBase, targetPath: result.targetPath, warning: result.warning });
        } else {
          installed.push({ ...recordBase, targetPath: result.targetPath });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ ...recordBase, error: message });
      }
    }

    const result: SkillInstallCommitResult = {
      installId,
      scope: session.scope,
      targetRoot,
      installed,
      skipped,
      failed,
      total: selectedCandidates.length,
    };
    session.state = "committed";
    session.updatedAt = nowMs();
    session.result = result;
    return result;
  });
}

export function resetSkillInstallSessionsForTest(): void {
  installSessions.clear();
}

export async function skillInstallSweepExpiredSessions(): Promise<number> {
  return cleanupExpiredSessions();
}

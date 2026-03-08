import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type MemoryProjectConfig = {
  autoMemoryEnabled?: boolean;
};

type MemoryConfigFile = {
  version: 1;
  projects: Record<string, MemoryProjectConfig>;
};

export interface MemoryCenterStatus {
  projectKey: string;
  autoMemoryEnabled: boolean;
  claudeFiles: string[];
  ruleFiles: string[];
  autoMemoryRoot: string;
  autoMemoryFiles: string[];
}

const MEMORY_SETTINGS_FILE = join(homedir(), ".yuanio", "memory-settings.json");

function normalizeProjectKey(cwd: string): string {
  return resolve(cwd).toLowerCase();
}

function slugifyProject(cwd: string): string {
  const leaf = basename(resolve(cwd)) || "project";
  const safeLeaf = leaf.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const hash = Buffer.from(resolve(cwd)).toString("base64url").slice(0, 12);
  return `${safeLeaf}-${hash}`;
}

function ensureParent(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function readMemoryConfig(): MemoryConfigFile {
  if (!existsSync(MEMORY_SETTINGS_FILE)) {
    return { version: 1, projects: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(MEMORY_SETTINGS_FILE, "utf-8")) as Partial<MemoryConfigFile>;
    if (!raw || typeof raw !== "object") return { version: 1, projects: {} };
    return {
      version: 1,
      projects: typeof raw.projects === "object" && raw.projects ? raw.projects as Record<string, MemoryProjectConfig> : {},
    };
  } catch {
    return { version: 1, projects: {} };
  }
}

function writeMemoryConfig(data: MemoryConfigFile): void {
  ensureParent(MEMORY_SETTINGS_FILE);
  writeFileSync(MEMORY_SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function collectRuleFiles(root: string): string[] {
  const dir = join(root, ".claude", "rules");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (path: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(path, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (st.isFile() && full.toLowerCase().endsWith(".md")) {
          out.push(resolve(full));
        }
      } catch {
        // ignore
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function collectClaudeFiles(cwd: string): string[] {
  const files: string[] = [];
  let cur = resolve(cwd);
  while (true) {
    for (const candidate of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]) {
      const full = join(cur, candidate);
      if (existsSync(full)) files.push(resolve(full));
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
}

export function getAutoMemoryRoot(cwd = process.cwd()): string {
  const projectSlug = slugifyProject(cwd);
  return join(homedir(), ".yuanio", "projects", projectSlug, "memory");
}

function ensureAutoMemoryFiles(cwd = process.cwd()): string {
  const root = getAutoMemoryRoot(cwd);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const memoryFile = join(root, "MEMORY.md");
  if (!existsSync(memoryFile)) {
    writeFileSync(
      memoryFile,
      [
        "# MEMORY",
        "",
        "- 该文件用于沉淀项目长期记忆（首 200 行优先注入）。",
        "- 建议把详细内容拆分到 topic 文件。",
      ].join("\n"),
      "utf-8",
    );
  }
  return root;
}

function listAutoMemoryFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => resolve(root, f))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function isAutoMemoryEnabled(cwd = process.cwd()): boolean {
  const config = readMemoryConfig();
  const key = normalizeProjectKey(cwd);
  return config.projects[key]?.autoMemoryEnabled !== false;
}

export function setAutoMemoryEnabled(enabled: boolean, cwd = process.cwd()): boolean {
  const config = readMemoryConfig();
  const key = normalizeProjectKey(cwd);
  config.projects[key] = {
    ...(config.projects[key] || {}),
    autoMemoryEnabled: enabled,
  };
  writeMemoryConfig(config);
  return enabled;
}

export function getMemoryCenterStatus(cwd = process.cwd()): MemoryCenterStatus {
  const root = ensureAutoMemoryFiles(cwd);
  return {
    projectKey: normalizeProjectKey(cwd),
    autoMemoryEnabled: isAutoMemoryEnabled(cwd),
    claudeFiles: collectClaudeFiles(cwd),
    ruleFiles: collectRuleFiles(cwd),
    autoMemoryRoot: root,
    autoMemoryFiles: listAutoMemoryFiles(root),
  };
}

function trimMemoryLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function appendAutoMemoryNote(
  note: string,
  options?: { topic?: string; cwd?: string },
): { file: string; indexUpdated: boolean } {
  const cwd = options?.cwd || process.cwd();
  const root = ensureAutoMemoryFiles(cwd);
  const clean = trimMemoryLine(note);
  if (!clean) {
    return { file: join(root, "MEMORY.md"), indexUpdated: false };
  }

  const now = new Date().toISOString();
  const topic = options?.topic?.trim();
  const topicFile = topic ? join(root, `${topic.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`) : null;
  const targetFile = topicFile || join(root, "MEMORY.md");
  const block = `- ${now} ${clean}\n`;

  if (!existsSync(targetFile)) {
    writeFileSync(targetFile, `# ${basename(targetFile, ".md").toUpperCase()}\n\n${block}`, "utf-8");
  } else {
    writeFileSync(targetFile, `${readFileSync(targetFile, "utf-8").trimEnd()}\n${block}`, "utf-8");
  }

  const indexFile = join(root, "MEMORY.md");
  if (targetFile !== indexFile) {
    const pointer = `- ${now} [${basename(targetFile)}] ${clean}`;
    const index = existsSync(indexFile) ? readFileSync(indexFile, "utf-8").trimEnd() : "# MEMORY";
    writeFileSync(indexFile, `${index}\n${pointer}\n`, "utf-8");
    return { file: targetFile, indexUpdated: true };
  }
  return { file: targetFile, indexUpdated: false };
}

export function buildAutoMemoryContext(cwd = process.cwd(), maxLines = 200): string {
  if (!isAutoMemoryEnabled(cwd)) return "";
  const root = ensureAutoMemoryFiles(cwd);
  const indexFile = join(root, "MEMORY.md");
  if (!existsSync(indexFile)) return "";
  try {
    const lines = readFileSync(indexFile, "utf-8").split(/\r?\n/).slice(0, Math.max(1, maxLines));
    const body = lines.join("\n").trim();
    if (!body) return "";
    return [
      "[Auto Memory]",
      "```markdown",
      body,
      "```",
    ].join("\n");
  } catch {
    return "";
  }
}


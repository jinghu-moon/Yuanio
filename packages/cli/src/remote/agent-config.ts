import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AgentSpec {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  disallowedTools: string[];
  model?: string;
  permissionMode?: string;
  memory?: "user" | "project" | "local";
  background?: boolean;
  isolation?: "worktree";
  maxTurns?: number;
  path: string;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: {}, body: text };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).trimStart();
  const out: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return { frontmatter: out, body };
}

function splitCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

function parseAgentFile(path: string): AgentSpec | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parseFrontmatter(raw);
    const fm = parsed.frontmatter;
    const name = (fm.name || "").trim() || path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || "agent";
    const description = (fm.description || "").trim() || "(no description)";
    return {
      name,
      description,
      prompt: parsed.body.trim(),
      tools: splitCsv(fm.tools),
      disallowedTools: splitCsv(fm.disallowedtools),
      model: fm.model?.trim() || undefined,
      permissionMode: fm.permissionmode?.trim() || undefined,
      memory: (fm.memory === "user" || fm.memory === "project" || fm.memory === "local")
        ? fm.memory
        : undefined,
      background: parseBool(fm.background),
      isolation: fm.isolation === "worktree" ? "worktree" : undefined,
      maxTurns: Number.isFinite(Number(fm.maxturns)) ? Number(fm.maxturns) : undefined,
      path: resolve(path),
    };
  } catch {
    return null;
  }
}

function findAgentFiles(cwd: string): string[] {
  const dirs = [
    join(cwd, ".claude", "agents"),
    join(cwd, ".agents", "agents"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isFile() && full.toLowerCase().endsWith(".md")) files.push(resolve(full));
      } catch {
        // ignore
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function listAgentSpecs(cwd = process.cwd()): AgentSpec[] {
  const files = findAgentFiles(cwd);
  const pick = new Map<string, AgentSpec>();
  // .claude 优先于 .agents，项目内同名去重
  const ordered = files.sort((a, b) => {
    const rank = (path: string) => (path.includes("\\.claude\\") || path.includes("/.claude/")) ? 0 : 1;
    return rank(a) - rank(b);
  });
  for (const path of ordered) {
    const parsed = parseAgentFile(path);
    if (!parsed) continue;
    const key = parsed.name.toLowerCase();
    if (!pick.has(key)) pick.set(key, parsed);
  }
  return Array.from(pick.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderFrontmatter(agent: Omit<AgentSpec, "path">): string {
  const lines = [
    "---",
    `name: ${agent.name}`,
    `description: ${agent.description}`,
  ];
  if (agent.tools.length > 0) lines.push(`tools: ${agent.tools.join(", ")}`);
  if (agent.disallowedTools.length > 0) lines.push(`disallowedTools: ${agent.disallowedTools.join(", ")}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.permissionMode) lines.push(`permissionMode: ${agent.permissionMode}`);
  if (agent.memory) lines.push(`memory: ${agent.memory}`);
  if (typeof agent.background === "boolean") lines.push(`background: ${agent.background ? "true" : "false"}`);
  if (agent.isolation) lines.push(`isolation: ${agent.isolation}`);
  if (typeof agent.maxTurns === "number" && Number.isFinite(agent.maxTurns)) lines.push(`maxTurns: ${Math.max(1, Math.floor(agent.maxTurns))}`);
  lines.push("---", "");
  return lines.join("\n");
}

export function saveAgentSpec(
  agent: Omit<AgentSpec, "path">,
  cwd = process.cwd(),
): AgentSpec {
  const dir = join(cwd, ".claude", "agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safeName = agent.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "agent";
  const file = join(dir, `${safeName}.md`);
  const text = `${renderFrontmatter(agent)}${agent.prompt.trim()}\n`;
  writeFileSync(file, text, "utf-8");
  const parsed = parseAgentFile(file);
  if (!parsed) {
    throw new Error("failed to parse saved agent file");
  }
  return parsed;
}

export function deleteAgentSpec(agentName: string, cwd = process.cwd()): boolean {
  const specs = listAgentSpecs(cwd);
  const hit = specs.find((item) => item.name.toLowerCase() === agentName.trim().toLowerCase());
  if (!hit) return false;
  try {
    unlinkSync(hit.path);
    return true;
  } catch {
    return false;
  }
}

export function buildAgentDelegationPrompt(
  agentName: string,
  task: string,
  cwd = process.cwd(),
): { agent: AgentSpec; prompt: string } | null {
  const hit = listAgentSpecs(cwd).find((item) => item.name.toLowerCase() === agentName.trim().toLowerCase());
  if (!hit) return null;
  const prompt = [
    `你现在扮演子代理: ${hit.name}`,
    `描述: ${hit.description}`,
    hit.model ? `模型偏好: ${hit.model}` : undefined,
    hit.permissionMode ? `权限模式: ${hit.permissionMode}` : undefined,
    hit.tools.length > 0 ? `允许工具: ${hit.tools.join(", ")}` : undefined,
    hit.disallowedTools.length > 0 ? `禁止工具: ${hit.disallowedTools.join(", ")}` : undefined,
    "",
    "子代理系统提示:",
    hit.prompt,
    "",
    "用户任务:",
    task,
  ].filter(Boolean).join("\n");
  return { agent: hit, prompt };
}


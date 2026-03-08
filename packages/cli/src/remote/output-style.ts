import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface OutputStyleItem {
  id: string;
  name: string;
  description: string;
  instructions: string;
  keepCodingInstructions: boolean;
  source: "builtin" | "project" | "user";
  path?: string;
}

type StyleConfigFile = {
  version: 1;
  projects: Record<string, { styleId: string }>;
};

const STYLE_CONFIG_FILE = join(homedir(), ".yuanio", "output-style.json");

const BUILTIN_STYLES: OutputStyleItem[] = [
  {
    id: "default",
    name: "Default",
    description: "标准输出风格",
    instructions: "",
    keepCodingInstructions: true,
    source: "builtin",
  },
  {
    id: "explanatory",
    name: "Explanatory",
    description: "强调解释实现思路与代码路径",
    instructions: [
      "输出要求：在给结论后补充实现原因与关键路径解释。",
      "优先指出影响范围、风险点、以及为何这么改。",
    ].join("\n"),
    keepCodingInstructions: true,
    source: "builtin",
  },
  {
    id: "learning",
    name: "Learning",
    description: "引导式学习风格",
    instructions: [
      "输出要求：在完成任务时给出简短练习点。",
      "如适合，请标注 TODO(human) 供用户手动补全小片段。",
    ].join("\n"),
    keepCodingInstructions: true,
    source: "builtin",
  },
];

function projectKey(cwd: string): string {
  return resolve(cwd).toLowerCase();
}

function readConfig(): StyleConfigFile {
  if (!existsSync(STYLE_CONFIG_FILE)) return { version: 1, projects: {} };
  try {
    const parsed = JSON.parse(readFileSync(STYLE_CONFIG_FILE, "utf-8")) as Partial<StyleConfigFile>;
    return {
      version: 1,
      projects: (parsed.projects && typeof parsed.projects === "object")
        ? parsed.projects as Record<string, { styleId: string }>
        : {},
    };
  } catch {
    return { version: 1, projects: {} };
  }
}

function writeConfig(data: StyleConfigFile): void {
  const parent = dirname(STYLE_CONFIG_FILE);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(STYLE_CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { fm: {}, body: raw };
  const fmRaw = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trimStart();
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { fm, body };
}

function normalizeBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

function readCustomStylesInDir(dir: string, source: "project" | "user"): OutputStyleItem[] {
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: OutputStyleItem[] = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".md")) continue;
    const full = join(dir, file);
    try {
      const raw = readFileSync(full, "utf-8");
      const { fm, body } = parseFrontmatter(raw);
      const id = basename(file, ".md").trim().toLowerCase();
      out.push({
        id,
        name: fm.name?.trim() || basename(file, ".md"),
        description: fm.description?.trim() || "(custom style)",
        instructions: body.trim(),
        keepCodingInstructions: normalizeBool(fm["keep-coding-instructions"], false),
        source,
        path: resolve(full),
      });
    } catch {
      // ignore bad file
    }
  }
  return out;
}

export function listOutputStyles(cwd = process.cwd()): OutputStyleItem[] {
  const projectStyles = readCustomStylesInDir(join(cwd, ".claude", "output-styles"), "project");
  const userStyles = readCustomStylesInDir(join(homedir(), ".claude", "output-styles"), "user");
  const dedup = new Map<string, OutputStyleItem>();

  const all = [...BUILTIN_STYLES, ...userStyles, ...projectStyles];
  for (const item of all) {
    const key = item.id.toLowerCase();
    if (!dedup.has(key) || item.source === "project") {
      dedup.set(key, item);
    }
  }
  return Array.from(dedup.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function getCurrentOutputStyleId(cwd = process.cwd()): string {
  const config = readConfig();
  const key = projectKey(cwd);
  const styleId = config.projects[key]?.styleId || "default";
  return styleId;
}

export function setCurrentOutputStyleId(styleId: string, cwd = process.cwd()): string {
  const normalized = (styleId || "default").trim().toLowerCase();
  const available = listOutputStyles(cwd).map((item) => item.id.toLowerCase());
  const finalId = available.includes(normalized) ? normalized : "default";
  const config = readConfig();
  const key = projectKey(cwd);
  config.projects[key] = { styleId: finalId };
  writeConfig(config);
  return finalId;
}

export function getCurrentOutputStyle(cwd = process.cwd()): OutputStyleItem {
  const currentId = getCurrentOutputStyleId(cwd);
  return listOutputStyles(cwd).find((item) => item.id.toLowerCase() === currentId) || BUILTIN_STYLES[0];
}

export function applyOutputStyleToPrompt(prompt: string, style: OutputStyleItem): string {
  if (!style.instructions.trim() || style.id === "default") return prompt;
  return [
    `你当前输出风格: ${style.name}`,
    style.instructions.trim(),
    "",
    "原始请求:",
    prompt,
  ].join("\n");
}


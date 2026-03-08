import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

type SkillScope = "project" | "user";
type SkillSource = ".agents" | ".claude";

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  source: SkillSource;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  context: "inline" | "fork";
  allowedTools: string[];
  agent?: string;
  model?: string;
  argumentHint?: string;
}

export interface SkillFile {
  frontmatter: Record<string, string>;
  body: string;
}

function normalizeBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

function parseSimpleYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
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
  return out;
}

export function parseSkillFile(skillPath: string): SkillFile | null {
  try {
    const raw = readFileSync(skillPath, "utf-8");
    if (!raw.startsWith("---")) {
      return { frontmatter: {}, body: raw };
    }
    const end = raw.indexOf("\n---", 4);
    if (end < 0) {
      return { frontmatter: {}, body: raw };
    }
    const fmText = raw.slice(3, end).trim();
    const body = raw.slice(end + 4).trimStart();
    return { frontmatter: parseSimpleYaml(fmText), body };
  } catch {
    return null;
  }
}

function findSkillsInRoot(rootDir: string, scope: SkillScope, source: SkillSource): SkillMeta[] {
  if (!existsSync(rootDir)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const entry of entries) {
    const fullDir = join(rootDir, entry);
    try {
      const st = statSync(fullDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = join(fullDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const parsed = parseSkillFile(skillFile);
    if (!parsed) continue;
    const fm = parsed.frontmatter;
    const firstParagraph = parsed.body
      .split(/\r?\n\r?\n/)
      .map((part) => part.trim())
      .find(Boolean) || "";
    const name = (fm.name || basename(fullDir)).trim();
    const allowedTools = (fm["allowed-tools"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const context = (fm.context || "").trim().toLowerCase() === "fork" ? "fork" : "inline";
    const description = (fm.description || firstParagraph || "(no description)").trim();
    skills.push({
      id: `${scope}:${source}:${name}`,
      name,
      description,
      path: skillFile,
      scope,
      source,
      disableModelInvocation: normalizeBool(fm["disable-model-invocation"], false),
      userInvocable: normalizeBool(fm["user-invocable"], true),
      context,
      allowedTools,
      agent: fm.agent?.trim() || undefined,
      model: fm.model?.trim() || undefined,
      argumentHint: fm["argument-hint"]?.trim() || undefined,
    });
  }
  return skills;
}

function dedupByPriority(skills: SkillMeta[]): SkillMeta[] {
  const pick = new Map<string, SkillMeta>();
  const ordered = [...skills].sort((a, b) => {
    const rank = (item: SkillMeta): number => {
      if (item.scope === "project" && item.source === ".agents") return 0;
      if (item.scope === "project" && item.source === ".claude") return 1;
      if (item.scope === "user" && item.source === ".agents") return 2;
      return 3;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const item of ordered) {
    const key = item.name.toLowerCase();
    if (!pick.has(key)) pick.set(key, item);
  }
  return Array.from(pick.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverSkills(cwd = process.cwd()): SkillMeta[] {
  const home = homedir();
  const roots: Array<{ dir: string; scope: SkillScope; source: SkillSource }> = [
    { dir: join(cwd, ".agents", "skills"), scope: "project", source: ".agents" },
    { dir: join(cwd, ".claude", "skills"), scope: "project", source: ".claude" },
    { dir: join(home, ".agents", "skills"), scope: "user", source: ".agents" },
    { dir: join(home, ".claude", "skills"), scope: "user", source: ".claude" },
  ];

  const all: SkillMeta[] = [];
  for (const root of roots) {
    all.push(...findSkillsInRoot(root.dir, root.scope, root.source));
  }
  return dedupByPriority(all);
}

function renderSkillArgsTemplate(input: string, argsRaw: string): string {
  const args = argsRaw.trim().split(/\s+/).filter(Boolean);
  let text = input.replace(/\$ARGUMENTS/g, argsRaw);
  text = text.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx) => args[Number(idx)] || "");
  text = text.replace(/\$(\d+)/g, (_, idx) => args[Number(idx)] || "");
  if (argsRaw && !/\$ARGUMENTS|\$[0-9]/.test(input)) {
    text += `\n\nARGUMENTS: ${argsRaw}`;
  }
  return text;
}

export function buildSkillPromptByName(
  skillName: string,
  args = "",
  cwd = process.cwd(),
): { skill: SkillMeta; prompt: string } | null {
  const skills = discoverSkills(cwd);
  const hit = skills.find((item) => item.name.toLowerCase() === skillName.trim().toLowerCase());
  if (!hit) return null;
  const parsed = parseSkillFile(hit.path);
  if (!parsed) return null;
  const rendered = renderSkillArgsTemplate(parsed.body, args.trim());
  return { skill: hit, prompt: rendered.trim() };
}

export function listSlashCommandFiles(cwd = process.cwd()): Array<{ name: string; file: string; scope: SkillScope }> {
  const home = homedir();
  const roots: Array<{ dir: string; scope: SkillScope }> = [
    { dir: join(cwd, ".claude", "commands"), scope: "project" },
    { dir: join(home, ".claude", "commands"), scope: "user" },
  ];
  const items: Array<{ name: string; file: string; scope: SkillScope }> = [];
  for (const root of roots) {
    if (!existsSync(root.dir)) continue;
    let files: string[] = [];
    try {
      files = readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".md")) continue;
      items.push({
        name: file.replace(/\.md$/i, ""),
        file: resolve(root.dir, file),
        scope: root.scope,
      });
    }
  }

  const dedup = new Map<string, { name: string; file: string; scope: SkillScope }>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (!dedup.has(key) || (dedup.get(key)?.scope === "user" && item.scope === "project")) {
      dedup.set(key, item);
    }
  }
  return Array.from(dedup.values()).sort((a, b) => a.name.localeCompare(b.name));
}

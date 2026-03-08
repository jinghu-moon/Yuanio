import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const CONTEXT_MAX_CHARS = Number(process.env.YUANIO_CONTEXT_MAX_CHARS ?? 14_000);
const CONTEXT_MAX_PER_BLOCK = Number(process.env.YUANIO_CONTEXT_MAX_PER_BLOCK ?? 4_000);

function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}\n...(truncated)`;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function extractRefs(prompt: string): string[] {
  const refs: string[] = [];
  const regex = /(^|\s)@([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(prompt)) !== null) {
    const token = m[2]?.trim();
    if (!token) continue;
    refs.push(token);
  }
  return unique(refs);
}

async function loadTextFile(path: string): Promise<string | null> {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    const text = await Bun.file(path).text();
    return text;
  } catch {
    return null;
  }
}

export interface PromptContextResult {
  prompt: string;
  refs: string[];
  resolved: string[];
  unresolved: string[];
}

export interface PromptContextOptions {
  cwd?: string;
  terminalSnapshot?: () => string;
}

export async function applyPromptContextRefs(
  prompt: string,
  options: PromptContextOptions = {},
): Promise<PromptContextResult> {
  const refs = extractRefs(prompt);
  if (refs.length === 0) {
    return { prompt, refs: [], resolved: [], unresolved: [] };
  }

  const cwd = options.cwd || process.cwd();
  let budget = Math.max(2_000, CONTEXT_MAX_CHARS);
  const blocks: string[] = [];
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const ref of refs) {
    if (budget <= 0) break;
    let title = `@${ref}`;
    let content: string | null = null;

    if (ref === "cwd") {
      content = cwd;
    } else if (ref === "diff") {
      try {
        const proc = Bun.spawn(["git", "diff", "--"], { stdout: "pipe", stderr: "pipe", cwd });
        const out = await new Response(proc.stdout).text();
        content = out.trim() || "(no diff)";
      } catch {
        content = null;
      }
    } else if (ref === "terminal") {
      const snapshot = options.terminalSnapshot?.() || "";
      content = snapshot.trim() || "(no terminal logs)";
    } else if (ref.startsWith("docs:")) {
      const raw = ref.slice("docs:".length).trim();
      if (raw) {
        const full = resolve(cwd, "docs", raw);
        title = `@docs:${raw}`;
        content = await loadTextFile(full);
      }
    } else {
      const full = resolve(cwd, ref);
      if (existsSync(full)) {
        content = await loadTextFile(full);
      }
    }

    if (typeof content === "string") {
      const body = clamp(content, Math.min(CONTEXT_MAX_PER_BLOCK, budget));
      const block = [
        `[Context ${title}]`,
        "```text",
        body,
        "```",
      ].join("\n");
      blocks.push(block);
      budget -= block.length;
      resolved.push(ref);
    } else {
      unresolved.push(ref);
    }
  }

  if (blocks.length === 0) {
    return { prompt, refs, resolved, unresolved };
  }

  const unresolvedHint = unresolved.length > 0
    ? `\n\n[Context unresolved] ${unresolved.map((item) => `@${item}`).join(", ")}`
    : "";

  return {
    prompt: `${prompt}\n\n---\n附加上下文（自动展开）:\n${blocks.join("\n\n")}${unresolvedHint}`,
    refs,
    resolved,
    unresolved,
  };
}

export function createTerminalSnapshotStore(maxLines = 120) {
  const lines: string[] = [];
  return {
    append(line: string) {
      const clean = line.trim();
      if (!clean) return;
      lines.push(clean);
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
    },
    snapshot(limit = 60): string {
      return lines.slice(-Math.max(1, limit)).join("\n");
    },
  };
}


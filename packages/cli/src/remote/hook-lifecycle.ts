import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "TaskCompleted"
  | "ConfigChange"
  | "Stop";

type HookHandler = {
  type: "command" | "http" | "prompt" | "agent";
  command?: string;
  url?: string;
  prompt?: string;
  timeout?: number;
  headers?: Record<string, string>;
};

type HookMatcherGroup = {
  matcher?: string;
  hooks: HookHandler[];
};

type HookConfig = {
  hooks: Partial<Record<HookEventName, HookMatcherGroup[]>>;
};

export interface HookRunResult {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
  events: Array<{ type: HookHandler["type"]; ok: boolean; detail?: string }>;
}

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function loadConfigFromSettings(path: string): HookConfig | null {
  if (!existsSync(path)) return null;
  const raw = parseJsonSafe<Record<string, unknown>>(readFileSync(path, "utf-8"));
  if (!raw || typeof raw !== "object") return null;
  const hooks = raw.hooks;
  if (!hooks || typeof hooks !== "object") return null;
  return { hooks: hooks as HookConfig["hooks"] };
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(500, Math.floor(n * 1000));
}

function matcherMatched(matcher: string | undefined, payload: Record<string, unknown>): boolean {
  const pattern = (matcher || "").trim();
  if (!pattern || pattern === "*" || pattern === ".*") return true;
  const target = String(payload.tool_name || payload.tool || payload.source || payload.event || "");
  try {
    return new RegExp(pattern, "i").test(target);
  } catch {
    return false;
  }
}

function parseHookDecision(
  data: Record<string, unknown> | null,
): { blocked: boolean; reason?: string; context?: string } {
  if (!data) return { blocked: false };
  const decision = String(data.decision || "").toLowerCase();
  if (decision === "block" || decision === "deny") {
    return {
      blocked: true,
      reason: String(data.reason || data.permissionDecisionReason || "blocked by hook"),
      context: typeof data.context === "string" ? data.context : undefined,
    };
  }
  const hookSpecificOutput = data.hookSpecificOutput as Record<string, unknown> | undefined;
  if (hookSpecificOutput) {
    const pd = String(hookSpecificOutput.permissionDecision || "").toLowerCase();
    if (pd === "deny" || pd === "block") {
      return {
        blocked: true,
        reason: String(hookSpecificOutput.permissionDecisionReason || "blocked by hookSpecificOutput"),
      };
    }
    if (typeof hookSpecificOutput.additionalContext === "string") {
      return { blocked: false, context: hookSpecificOutput.additionalContext };
    }
  }
  if (typeof data.context === "string") return { blocked: false, context: data.context };
  return { blocked: false };
}

async function runCommandHook(
  handler: HookHandler,
  payload: Record<string, unknown>,
): Promise<{ blocked: boolean; reason?: string; context?: string; detail?: string }> {
  const command = handler.command?.trim();
  if (!command) return { blocked: false, detail: "command empty" };
  const args = process.platform === "win32"
    ? ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
    : ["sh", "-lc", command];
  const timeoutMs = normalizeTimeoutMs(handler.timeout, 10);

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
    env: { ...process.env, TERM: "dumb" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch {}
  }, timeoutMs);
  try {
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) return { blocked: false, detail: "timeout" };
    if (code === 2) return { blocked: true, reason: stderr.trim() || "blocked by hook exit code 2" };
    if (code !== 0) return { blocked: false, detail: stderr.trim() || `exit=${code}` };
    const decision = parseHookDecision(parseJsonSafe<Record<string, unknown>>(stdout.trim()));
    return { blocked: decision.blocked, reason: decision.reason, context: decision.context };
  } catch (error) {
    return { blocked: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function runHttpHook(
  handler: HookHandler,
  payload: Record<string, unknown>,
): Promise<{ blocked: boolean; reason?: string; context?: string; detail?: string }> {
  const url = handler.url?.trim();
  if (!url) return { blocked: false, detail: "url empty" };
  const timeoutMs = normalizeTimeoutMs(handler.timeout, 6);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(handler.headers || {}),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return { blocked: false, detail: `status=${res.status}` };
    const text = await res.text();
    const decision = parseHookDecision(parseJsonSafe<Record<string, unknown>>(text.trim()));
    return { blocked: decision.blocked, reason: decision.reason, context: decision.context };
  } catch (error) {
    return { blocked: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function runPromptLikeHook(
  handler: HookHandler,
  payload: Record<string, unknown>,
): { blocked: boolean; reason?: string; context?: string; detail?: string } {
  // 轻量实现：支持最常见的规则表达，不依赖外部模型。
  // prompt 示例:
  // - "deny_if_contains=rm -rf"
  // - "inject_context: xxx"
  const prompt = String(handler.prompt || "").trim();
  if (!prompt) return { blocked: false, detail: "prompt empty" };
  const payloadText = JSON.stringify(payload);
  const denyRule = /deny_if_contains=(.+)$/im.exec(prompt);
  if (denyRule?.[1] && payloadText.toLowerCase().includes(denyRule[1].trim().toLowerCase())) {
    return { blocked: true, reason: `blocked by ${handler.type} hook rule` };
  }
  if (/always_deny/i.test(prompt)) {
    return { blocked: true, reason: `blocked by ${handler.type} hook(always_deny)` };
  }
  const inject = /inject_context:\s*([\s\S]+)/i.exec(prompt);
  if (inject?.[1]) {
    return { blocked: false, context: inject[1].trim() };
  }
  return { blocked: false };
}

function loadHookConfig(cwd = process.cwd()): HookConfig {
  const envFile = (process.env.YUANIO_HOOKS_FILE || "").trim();
  const candidates = [
    envFile ? resolve(envFile) : "",
    resolve(cwd, ".claude", "settings.local.json"),
    resolve(cwd, ".claude", "settings.json"),
    resolve(homedirSafe(), ".claude", "settings.json"),
  ].filter(Boolean);

  const merged: HookConfig = { hooks: {} };
  for (const file of candidates) {
    const cfg = loadConfigFromSettings(file);
    if (!cfg?.hooks) continue;
    for (const [event, groups] of Object.entries(cfg.hooks)) {
      if (!Array.isArray(groups)) continue;
      const key = event as HookEventName;
      if (!merged.hooks[key]) merged.hooks[key] = [];
      merged.hooks[key]!.push(...groups as HookMatcherGroup[]);
    }
  }
  return merged;
}

function homedirSafe(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

export function createHookLifecycle(cwd = process.cwd()) {
  let config = loadHookConfig(cwd);
  return {
    reload() {
      config = loadHookConfig(cwd);
      return config;
    },
    async run(event: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult> {
      const groups = config.hooks[event] || [];
      const result: HookRunResult = {
        blocked: false,
        injectedContext: [],
        events: [],
      };
      for (const group of groups) {
        if (!matcherMatched(group.matcher, payload)) continue;
        for (const handler of group.hooks || []) {
          let out: { blocked: boolean; reason?: string; context?: string; detail?: string };
          if (handler.type === "command") {
            out = await runCommandHook(handler, payload);
          } else if (handler.type === "http") {
            out = await runHttpHook(handler, payload);
          } else {
            out = runPromptLikeHook(handler, payload);
          }
          result.events.push({ type: handler.type, ok: !out.blocked, detail: out.detail });
          if (out.context) result.injectedContext.push(out.context);
          if (out.blocked) {
            result.blocked = true;
            result.reason = out.reason || `blocked by ${handler.type} hook`;
            return result;
          }
        }
      }
      return result;
    },
  };
}


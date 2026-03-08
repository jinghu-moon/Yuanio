import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export interface PermissionRuleSet {
  allow: string[];
  ask: string[];
  deny: string[];
}

export interface SandboxPolicy {
  enabled: boolean;
  allowUnsandboxedCommands: boolean;
  allowedDomains: string[];
  allowWrite: string[];
  denyWrite: string[];
  denyRead: string[];
}

interface PolicyFile {
  version: 1;
  projects: Record<string, {
    rules?: PermissionRuleSet;
    sandbox?: SandboxPolicy;
  }>;
}

export type PermissionDecision = "allow" | "ask" | "deny" | "none";

const POLICY_FILE = resolve(homedir(), ".yuanio", "policies.json");

const DEFAULT_RULES: PermissionRuleSet = {
  allow: [],
  ask: [],
  deny: [],
};

const DEFAULT_SANDBOX: SandboxPolicy = {
  enabled: false,
  allowUnsandboxedCommands: true,
  allowedDomains: [],
  allowWrite: [],
  denyWrite: [],
  denyRead: [],
};

function projectKey(cwd: string): string {
  return resolve(cwd).toLowerCase();
}

function ensureParent(path: string): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPolicyFile(): PolicyFile {
  if (!existsSync(POLICY_FILE)) return { version: 1, projects: {} };
  try {
    const parsed = JSON.parse(readFileSync(POLICY_FILE, "utf-8")) as Partial<PolicyFile>;
    return {
      version: 1,
      projects: parsed.projects && typeof parsed.projects === "object"
        ? parsed.projects as PolicyFile["projects"]
        : {},
    };
  } catch {
    return { version: 1, projects: {} };
  }
}

function writePolicyFile(data: PolicyFile): void {
  ensureParent(POLICY_FILE);
  writeFileSync(POLICY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeRules(input: Partial<PermissionRuleSet> | undefined): PermissionRuleSet {
  return {
    allow: normalizeList(input?.allow),
    ask: normalizeList(input?.ask),
    deny: normalizeList(input?.deny),
  };
}

function normalizeSandbox(input: Partial<SandboxPolicy> | undefined): SandboxPolicy {
  return {
    enabled: input?.enabled === true,
    allowUnsandboxedCommands: input?.allowUnsandboxedCommands !== false,
    allowedDomains: normalizeList(input?.allowedDomains),
    allowWrite: normalizeList(input?.allowWrite),
    denyWrite: normalizeList(input?.denyWrite),
    denyRead: normalizeList(input?.denyRead),
  };
}

function parseRulesFromEnv(): Partial<PermissionRuleSet> {
  const split = (raw: string | undefined): string[] => (raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    allow: split(process.env.YUANIO_PERMISSION_ALLOW),
    ask: split(process.env.YUANIO_PERMISSION_ASK),
    deny: split(process.env.YUANIO_PERMISSION_DENY),
  };
}

export function getPermissionRules(cwd = process.cwd()): PermissionRuleSet {
  const file = readPolicyFile();
  const key = projectKey(cwd);
  const fromFile = normalizeRules(file.projects[key]?.rules || DEFAULT_RULES);
  const fromEnv = parseRulesFromEnv();
  return {
    allow: [...new Set([...fromFile.allow, ...normalizeList(fromEnv.allow)])],
    ask: [...new Set([...fromFile.ask, ...normalizeList(fromEnv.ask)])],
    deny: [...new Set([...fromFile.deny, ...normalizeList(fromEnv.deny)])],
  };
}

export function setPermissionRules(rules: Partial<PermissionRuleSet>, cwd = process.cwd()): PermissionRuleSet {
  const file = readPolicyFile();
  const key = projectKey(cwd);
  const next = normalizeRules(rules);
  file.projects[key] = {
    ...(file.projects[key] || {}),
    rules: next,
  };
  writePolicyFile(file);
  return next;
}

export function getSandboxPolicy(cwd = process.cwd()): SandboxPolicy {
  const file = readPolicyFile();
  const key = projectKey(cwd);
  return normalizeSandbox(file.projects[key]?.sandbox || DEFAULT_SANDBOX);
}

export function setSandboxPolicy(input: Partial<SandboxPolicy>, cwd = process.cwd()): SandboxPolicy {
  const file = readPolicyFile();
  const key = projectKey(cwd);
  const prev = normalizeSandbox(file.projects[key]?.sandbox || DEFAULT_SANDBOX);
  const next = normalizeSandbox({
    ...prev,
    ...input,
  });
  file.projects[key] = {
    ...(file.projects[key] || {}),
    sandbox: next,
  };
  writePolicyFile(file);
  return next;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function pickTargetText(tool: string, input: Record<string, unknown>): string {
  const low = tool.toLowerCase();
  if (low.includes("bash") || low.includes("shell")) {
    return String(input.command || "");
  }
  if (low.includes("read")) return String(input.path || input.file_path || "");
  if (low.includes("write") || low.includes("edit") || low.includes("rename") || low.includes("delete")) {
    return String(input.path || input.file_path || input.to || input.from || "");
  }
  return JSON.stringify(input);
}

function matchRule(rule: string, tool: string, input: Record<string, unknown>): boolean {
  const trimmed = rule.trim();
  if (!trimmed) return false;
  const m = /^([A-Za-z0-9_:-]+)(?:\((.*)\))?$/.exec(trimmed);
  if (!m) return false;
  const ruleTool = m[1].toLowerCase();
  const pattern = (m[2] || "").trim();
  const toolLow = tool.toLowerCase();
  if (ruleTool !== "*" && toolLow !== ruleTool && !toolLow.includes(ruleTool)) return false;
  if (!pattern) return true;
  const target = pickTargetText(tool, input);
  if (!target) return false;
  return globToRegExp(pattern).test(target);
}

export function evaluatePermissionRules(
  tool: string,
  input: Record<string, unknown>,
  rules: PermissionRuleSet,
): PermissionDecision {
  for (const rule of rules.deny) {
    if (matchRule(rule, tool, input)) return "deny";
  }
  for (const rule of rules.ask) {
    if (matchRule(rule, tool, input)) return "ask";
  }
  for (const rule of rules.allow) {
    if (matchRule(rule, tool, input)) return "allow";
  }
  return "none";
}

function hostMatches(host: string, pattern: string): boolean {
  const cleanHost = host.toLowerCase();
  const cleanPattern = pattern.toLowerCase();
  if (cleanPattern === "*") return true;
  if (cleanPattern.startsWith("*.")) {
    const suffix = cleanPattern.slice(1);
    return cleanHost.endsWith(suffix);
  }
  return cleanHost === cleanPattern;
}

function extractHosts(command: string): string[] {
  const hosts = new Set<string>();
  const regex = /https?:\/\/([a-zA-Z0-9._-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(command)) !== null) {
    const host = (m[1] || "").trim();
    if (host) hosts.add(host);
  }
  return Array.from(hosts);
}

function pathBlocked(pathValue: string, patterns: string[]): boolean {
  if (!pathValue || patterns.length === 0) return false;
  const target = resolve(pathValue).toLowerCase();
  for (const pattern of patterns) {
    const raw = pattern.trim();
    if (!raw) continue;
    const abs = resolve(raw);
    if (target === abs.toLowerCase() || target.startsWith(`${abs.toLowerCase()}\\`) || target.startsWith(`${abs.toLowerCase()}/`)) {
      return true;
    }
  }
  return false;
}

export function evaluateSandboxPolicy(
  tool: string,
  input: Record<string, unknown>,
  sandbox: SandboxPolicy,
): { allowed: boolean; reason?: string } {
  if (!sandbox.enabled) return { allowed: true };
  const low = tool.toLowerCase();
  const command = String(input.command || "");
  const path = String(input.path || input.file_path || "");
  if ((low.includes("bash") || low.includes("shell")) && command) {
    if (!sandbox.allowUnsandboxedCommands && /\bsudo\b|\brm\s+-rf\b|\bmkfs\b/.test(command)) {
      return { allowed: false, reason: "sandbox blocked dangerous shell command" };
    }
    const hosts = extractHosts(command);
    if (hosts.length > 0 && sandbox.allowedDomains.length > 0) {
      const allAllowed = hosts.every((host) => sandbox.allowedDomains.some((p) => hostMatches(host, p)));
      if (!allAllowed) return { allowed: false, reason: "sandbox blocked outbound domain" };
    }
  }
  if (low.includes("read") && pathBlocked(path, sandbox.denyRead)) {
    return { allowed: false, reason: "sandbox blocked read path" };
  }
  if ((low.includes("write") || low.includes("edit") || low.includes("delete") || low.includes("rename")) && path) {
    if (pathBlocked(path, sandbox.denyWrite)) {
      return { allowed: false, reason: "sandbox blocked write path" };
    }
    if (sandbox.allowWrite.length > 0 && !sandbox.allowWrite.some((p) => resolve(path).toLowerCase().startsWith(resolve(p).toLowerCase()))) {
      return { allowed: false, reason: "sandbox path not in allowWrite" };
    }
  }
  return { allowed: true };
}


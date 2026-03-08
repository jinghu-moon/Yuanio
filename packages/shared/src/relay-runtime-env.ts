import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MIN_JWT_SECRET_LENGTH = 32;

export interface RelayRuntimeEnvOptions {
  env?: NodeJS.ProcessEnv;
  startDir?: string;
  workspaceRoot?: string;
  homeDir?: string;
  extraFiles?: string[];
}

export interface RelayRuntimeEnvResult {
  env: NodeJS.ProcessEnv;
  sources: string[];
}

export function loadRelayRuntimeEnv(options: RelayRuntimeEnvOptions = {}): RelayRuntimeEnvResult {
  const fileEnv: NodeJS.ProcessEnv = {};
  const sources: string[] = [];

  for (const filePath of getRelayRuntimeEnvFiles(options)) {
    Object.assign(fileEnv, parseEnvFile(readFileSync(filePath, "utf8")));
    sources.push(resolve(filePath));
  }

  return {
    env: { ...fileEnv, ...(options.env ?? process.env) },
    sources,
  };
}

export function getRelayRuntimeEnvFiles(options: RelayRuntimeEnvOptions = {}): string[] {
  const files: string[] = [];
  const workspaceRoot = options.workspaceRoot
    || findWorkspaceRoot(options.startDir)
    || findWorkspaceRoot(import.meta.dir);

  if (workspaceRoot) {
    files.push(join(workspaceRoot, ".env"));
    files.push(join(workspaceRoot, ".env.local"));
  }

  const homeDir = options.homeDir || safeHomedir();
  if (homeDir) {
    files.push(join(homeDir, ".yuanio", "runtime.env"));
  }

  if (options.extraFiles?.length) {
    files.push(...options.extraFiles);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const filePath of files) {
    const normalized = resolve(filePath).toLowerCase();
    if (seen.has(normalized) || !existsSync(filePath)) continue;
    seen.add(normalized);
    result.push(filePath);
  }
  return result;
}

export function validateRelayRuntimeEnv(options: RelayRuntimeEnvOptions = {}): string[] {
  const { env } = loadRelayRuntimeEnv(options);
  const errors: string[] = [];
  const jwtSecret = env.JWT_SECRET?.trim();

  if (!jwtSecret) {
    errors.push("JWT_SECRET is required");
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  return errors;
}

export function requireRelayJwtSecret(options: RelayRuntimeEnvOptions = {}): string {
  const result = loadRelayRuntimeEnv(options);
  const jwtSecret = result.env.JWT_SECRET?.trim();

  if (!jwtSecret) {
    throw new Error(buildRelayRuntimeEnvError(
      ["JWT_SECRET is required"],
      result.sources,
    ));
  }

  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(buildRelayRuntimeEnvError(
      [`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`],
      result.sources,
    ));
  }

  return jwtSecret;
}

export function assertRelayRuntimeEnv(options: RelayRuntimeEnvOptions = {}): RelayRuntimeEnvResult {
  const result = loadRelayRuntimeEnv(options);
  const errors = validateRelayRuntimeEnv({ ...options, env: result.env });
  if (errors.length > 0) {
    throw new Error(buildRelayRuntimeEnvError(errors, result.sources));
  }
  return result;
}

function buildRelayRuntimeEnvError(errors: string[], sources: string[]): string {
  const sourceText = sources.length > 0
    ? `（已搜索: ${sources.join(", ")}）`
    : "（未找到 .env / .env.local / ~/.yuanio/runtime.env）";
  return `Relay 运行时配置无效: ${errors.join("; ")} ${sourceText}`;
}

function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const splitIndex = line.indexOf("=");
    if (splitIndex <= 0) continue;

    const key = line.slice(0, splitIndex).trim();
    let value = line.slice(splitIndex + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

function findWorkspaceRoot(startDir?: string): string | undefined {
  if (!startDir) return undefined;

  let current = resolve(startDir);
  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
        if (parsed.workspaces) {
          return current;
        }
      } catch {}
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function safeHomedir(): string | undefined {
  try {
    return homedir();
  } catch {
    return undefined;
  }
}

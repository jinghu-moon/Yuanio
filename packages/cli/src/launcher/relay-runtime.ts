import { assertRelayRuntimeEnv, type RelayRuntimeEnvOptions } from "@yuanio/shared";

export interface ResolveRelayLaunchEnvOptions extends RelayRuntimeEnvOptions {
  port: number;
  repoRoot?: string;
}

export interface RelayLaunchEnvResult {
  env: NodeJS.ProcessEnv;
  sources: string[];
}

export function resolveRelayLaunchEnv(options: ResolveRelayLaunchEnvOptions): RelayLaunchEnvResult {
  const result = assertRelayRuntimeEnv({
    env: options.env ?? process.env,
    startDir: options.repoRoot ?? options.startDir ?? process.cwd(),
    workspaceRoot: options.repoRoot ?? options.workspaceRoot,
    homeDir: options.homeDir,
    extraFiles: options.extraFiles,
  });

  return {
    env: {
      ...result.env,
      PORT: String(options.port),
    },
    sources: result.sources,
  };
}

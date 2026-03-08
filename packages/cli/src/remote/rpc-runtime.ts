import { resolveRpcRoot } from "./rpc-handlers";
import {
  createRpcDeps,
  type RpcDepsFactoryContext,
  type CreateRpcDepsOptions,
} from "./rpc-deps-factory";
import type { RpcSecurityConfig } from "./rpc-registry";
import type { DispatchRpcForTelegram } from "./telegram-rpc-handlers";

type PermissionSource = CreateRpcDepsOptions["permissionSource"];

export interface CreateRpcRuntimeOptions {
  depsContext: RpcDepsFactoryContext;
  dispatchRpc: (
    method: string,
    params: Record<string, unknown>,
    deps: ReturnType<typeof createRpcDeps> & { security: RpcSecurityConfig },
  ) => Promise<{ result?: unknown; error?: string; errorCode?: string }>;
}

function resolveRpcModeForTelegram(value?: string): "full" | "readonly" {
  return value?.toLowerCase() === "readonly" ? "readonly" : "full";
}

function resolveRpcAllowlistForTelegram(value?: string): Set<string> | null {
  if (!value) return null;
  const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? new Set(parts) : null;
}

function buildRpcSecurityForTelegram(): RpcSecurityConfig {
  return {
    mode: resolveRpcModeForTelegram(process.env.YUANIO_RPC_MODE),
    root: resolveRpcRoot(process.env.YUANIO_RPC_ROOT),
    allowlist: resolveRpcAllowlistForTelegram(process.env.YUANIO_RPC_ALLOW),
  };
}

export function createRpcRuntime(options: CreateRpcRuntimeOptions): {
  buildRpcDeps: (permissionSource: PermissionSource, method?: string) => ReturnType<typeof createRpcDeps>;
  dispatchRpcForTelegram: DispatchRpcForTelegram;
} {
  const buildRpcDeps = (permissionSource: PermissionSource, method?: string) => {
    return createRpcDeps(options.depsContext, {
      permissionSource,
      projectSwitchMethod: method,
      includeTargetInRewindPreview: permissionSource === "telegram",
    });
  };

  const dispatchRpcForTelegram: DispatchRpcForTelegram = async (
    method,
    params = {},
  ) => {
    return options.dispatchRpc(method, params, {
      security: buildRpcSecurityForTelegram(),
      ...buildRpcDeps("telegram", method),
    });
  };

  return {
    buildRpcDeps,
    dispatchRpcForTelegram,
  };
}

import { MessageType } from "@yuanio/shared";
import type { RpcReqPayload } from "@yuanio/shared";
import { RpcRegistry } from "./rpc-registry";
import type { RpcSecurityConfig } from "./rpc-registry";
import { createBuiltinHandlers, resolveRpcRoot } from "./rpc-handlers";

export interface RpcDeps {
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number) => Promise<void>;
  onProjectSwitched?: (path: string) => Promise<void> | void;
  getForegroundProbe?: () => Record<string, unknown>;
  getExecutionMode?: () => "act" | "plan";
  setExecutionMode?: (mode: "act" | "plan", source?: "app" | "telegram" | "system") => Promise<string> | string;
  getPermissionMode?: () => string;
  setPermissionMode?: (mode: string) => Promise<string> | string;
  listCheckpoints?: (limit?: number) => unknown[];
  restoreCheckpoint?: (id: string) => Promise<unknown>;
  getTaskPanel?: () => unknown;
  getContextUsage?: () => unknown;
  compactContext?: (instructions?: string) => Promise<unknown> | unknown;
  rewindPreview?: (target: string) => unknown;
  rewindToMessage?: (target: string, dryRun?: boolean) => Promise<unknown> | unknown;
  listTasks?: (limit?: number) => unknown[];
  getTaskOutput?: (taskId: string) => unknown;
  stopTask?: (taskId: string) => boolean;
  getMemoryStatus?: () => unknown;
  setMemoryEnabled?: (enabled: boolean) => unknown;
  addMemoryNote?: (note: string, topic?: string) => unknown;
  listAgents?: () => unknown[];
  saveAgent?: (agent: Record<string, unknown>) => unknown;
  deleteAgent?: (name: string) => boolean;
  getPermissionRules?: () => unknown;
  setPermissionRules?: (rules: Record<string, unknown>) => unknown;
  getSandboxPolicy?: () => unknown;
  setSandboxPolicy?: (policy: Record<string, unknown>) => unknown;
  listOutputStyles?: () => unknown[];
  getOutputStyle?: () => unknown;
  setOutputStyle?: (styleId: string) => unknown;
  getStatusline?: () => Promise<string> | string;
  setStatusline?: (input: { enabled?: boolean; command?: string }) => unknown;
  invokeSkill?: (name: string, args?: string) => Promise<unknown> | unknown;
  listSkills?: () => unknown[];
  listSlashCommands?: () => unknown[];
  skillInstallPrepare?: (input: { source: string; scope?: "project" | "user" }) => Promise<unknown> | unknown;
  skillInstallCommit?: (input: {
    installId: string;
    selected?: string[] | string;
    force?: boolean;
    conflictPolicy?: "skip" | "overwrite" | "rename";
  }) => Promise<unknown> | unknown;
  skillInstallCancel?: (input: { installId: string }) => Promise<unknown> | unknown;
  skillInstallStatus?: (input: { installId: string }) => Promise<unknown> | unknown;
}

// ── 全局单例 ──

export const rpcRegistry = new RpcRegistry();
rpcRegistry.registerAll(createBuiltinHandlers());

// ── 安全配置解析 ──

function resolveRpcMode(value?: string): "full" | "readonly" {
  return value?.toLowerCase() === "readonly" ? "readonly" : "full";
}

function resolveRpcAllowlist(value?: string): Set<string> | null {
  if (!value) return null;
  const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? new Set(parts) : null;
}

// ── handleRpc ──

export async function handleRpc(
  rpc: RpcReqPayload,
  deps: RpcDeps,
): Promise<void> {
  const security: RpcSecurityConfig = {
    mode: resolveRpcMode(process.env.YUANIO_RPC_MODE),
    root: resolveRpcRoot(process.env.YUANIO_RPC_ROOT),
    allowlist: resolveRpcAllowlist(process.env.YUANIO_RPC_ALLOW),
  };

  const { result, error, errorCode } = await rpcRegistry.dispatch(rpc.method, rpc.params, {
    security,
    sendEnvelope: deps.sendEnvelope,
    onProjectSwitched: deps.onProjectSwitched,
    getForegroundProbe: deps.getForegroundProbe,
    getExecutionMode: deps.getExecutionMode,
    setExecutionMode: deps.setExecutionMode,
    getPermissionMode: deps.getPermissionMode,
    setPermissionMode: deps.setPermissionMode,
    listCheckpoints: deps.listCheckpoints,
    restoreCheckpoint: deps.restoreCheckpoint,
    getTaskPanel: deps.getTaskPanel,
    getContextUsage: deps.getContextUsage,
    compactContext: deps.compactContext,
    rewindPreview: deps.rewindPreview,
    rewindToMessage: deps.rewindToMessage,
    listTasks: deps.listTasks,
    getTaskOutput: deps.getTaskOutput,
    stopTask: deps.stopTask,
    getMemoryStatus: deps.getMemoryStatus,
    setMemoryEnabled: deps.setMemoryEnabled,
    addMemoryNote: deps.addMemoryNote,
    listAgents: deps.listAgents,
    saveAgent: deps.saveAgent,
    deleteAgent: deps.deleteAgent,
    getPermissionRules: deps.getPermissionRules,
    setPermissionRules: deps.setPermissionRules,
    getSandboxPolicy: deps.getSandboxPolicy,
    setSandboxPolicy: deps.setSandboxPolicy,
    listOutputStyles: deps.listOutputStyles,
    getOutputStyle: deps.getOutputStyle,
    setOutputStyle: deps.setOutputStyle,
    getStatusline: deps.getStatusline,
    setStatusline: deps.setStatusline,
    invokeSkill: deps.invokeSkill,
    listSkills: deps.listSkills,
    listSlashCommands: deps.listSlashCommands,
    skillInstallPrepare: deps.skillInstallPrepare,
    skillInstallCommit: deps.skillInstallCommit,
    skillInstallCancel: deps.skillInstallCancel,
    skillInstallStatus: deps.skillInstallStatus,
  });

  const payload: Record<string, unknown> = { id: rpc.id };
  if (result !== undefined) payload.result = result;
  if (error !== undefined) payload.error = error;
  if (errorCode !== undefined) payload.errorCode = errorCode;
  await deps.sendEnvelope(MessageType.RPC_RESP, JSON.stringify(payload));
}


import type { PermissionMode } from "@yuanio/shared";
import type { RpcDeps } from "./rpc";

type PermissionSource = "app" | "telegram";

interface CheckpointTarget {
  id: string;
  promptId?: string;
  files: string[];
  createdAt: number;
  cwd: string;
  agent: string;
  promptPreview?: string;
}

export interface RpcDepsFactoryContext {
  sendEnvelope: RpcDeps["sendEnvelope"];
  refreshProjectScopedConfig: () => void;
  runProjectSwitchedHook: (method?: string) => Promise<void>;
  emitCwdChangedStatus: () => Promise<void>;
  heartbeatTick: () => Promise<void>;
  getForegroundProbe: () => Record<string, unknown>;
  getExecutionMode: () => "act" | "plan";
  setExecutionMode: NonNullable<RpcDeps["setExecutionMode"]>;
  getPermissionMode: () => PermissionMode;
  setPermissionModeByRpc: (
    mode: PermissionMode,
    source: "app" | "telegram" | "system",
  ) => Promise<string>;
  listCheckpoints: (limit?: number) => unknown[];
  restoreCheckpointById: (id: string) => Promise<string>;
  getTaskPanel: () => unknown;
  getContextUsage: () => unknown;
  compactContext: (instructions?: string) => Promise<unknown> | unknown;
  resolveCheckpointTarget: (target: string) => CheckpointTarget | null;
  rewindToMessage: (target: string, dryRun?: boolean) => Promise<unknown> | unknown;
  listTasks: (limit?: number) => unknown[];
  getTaskOutput: (taskId: string) => unknown;
  stopTask: (taskId: string) => boolean;
  getMemoryStatus: () => unknown;
  setMemoryEnabled: (enabled: boolean) => unknown;
  addMemoryNote: (note: string, topic?: string) => unknown;
  listAgents: () => unknown[];
  saveAgent: (agent: Record<string, unknown>) => unknown;
  deleteAgent: (name: string) => boolean;
  getPermissionRules: () => unknown;
  setPermissionRules: (rules: Record<string, unknown>) => unknown;
  getSandboxPolicy: () => unknown;
  setSandboxPolicy: (policy: Record<string, unknown>) => unknown;
  listOutputStyles: () => unknown[];
  getOutputStyle: () => unknown;
  setOutputStyle: (styleId: string) => unknown;
  getStatusline: () => Promise<string> | string;
  setStatusline: (input: { enabled?: boolean; command?: string }) => unknown;
  invokeSkill: (name: string, args?: string) => Promise<unknown> | unknown;
  listSkills: () => unknown[];
  listSlashCommands: () => unknown[];
}

export interface CreateRpcDepsOptions {
  permissionSource: PermissionSource;
  projectSwitchMethod?: string;
  includeTargetInRewindPreview?: boolean;
}

function buildRewindPreview(
  target: string,
  resolveCheckpointTarget: RpcDepsFactoryContext["resolveCheckpointTarget"],
  includeTargetInRewindPreview: boolean,
): Record<string, unknown> {
  const item = resolveCheckpointTarget(target);
  if (!item) return { found: false, target };
  const preview: Record<string, unknown> = {
    found: true,
    checkpointId: item.id,
    promptId: item.promptId,
    files: item.files.slice(0, 100),
    createdAt: item.createdAt,
    cwd: item.cwd,
    agent: item.agent,
    promptPreview: item.promptPreview,
  };
  if (includeTargetInRewindPreview) preview.target = target;
  return preview;
}

export function createRpcDeps(
  ctx: RpcDepsFactoryContext,
  options: CreateRpcDepsOptions,
): RpcDeps {
  return {
    sendEnvelope: ctx.sendEnvelope,
    onProjectSwitched: async () => {
      ctx.refreshProjectScopedConfig();
      await ctx.runProjectSwitchedHook(options.projectSwitchMethod);
      await ctx.emitCwdChangedStatus();
      await ctx.heartbeatTick();
    },
    getForegroundProbe: ctx.getForegroundProbe,
    getExecutionMode: ctx.getExecutionMode,
    setExecutionMode: ctx.setExecutionMode,
    getPermissionMode: ctx.getPermissionMode,
    setPermissionMode: (mode) => ctx.setPermissionModeByRpc(
      mode as PermissionMode,
      options.permissionSource,
    ),
    listCheckpoints: ctx.listCheckpoints,
    restoreCheckpoint: async (id) => ({ message: await ctx.restoreCheckpointById(id) }),
    getTaskPanel: ctx.getTaskPanel,
    getContextUsage: ctx.getContextUsage,
    compactContext: ctx.compactContext,
    rewindPreview: (target) => buildRewindPreview(
      target,
      ctx.resolveCheckpointTarget,
      options.includeTargetInRewindPreview === true,
    ),
    rewindToMessage: ctx.rewindToMessage,
    listTasks: ctx.listTasks,
    getTaskOutput: ctx.getTaskOutput,
    stopTask: ctx.stopTask,
    getMemoryStatus: ctx.getMemoryStatus,
    setMemoryEnabled: ctx.setMemoryEnabled,
    addMemoryNote: ctx.addMemoryNote,
    listAgents: ctx.listAgents,
    saveAgent: ctx.saveAgent,
    deleteAgent: ctx.deleteAgent,
    getPermissionRules: ctx.getPermissionRules,
    setPermissionRules: ctx.setPermissionRules,
    getSandboxPolicy: ctx.getSandboxPolicy,
    setSandboxPolicy: ctx.setSandboxPolicy,
    listOutputStyles: ctx.listOutputStyles,
    getOutputStyle: ctx.getOutputStyle,
    setOutputStyle: ctx.setOutputStyle,
    getStatusline: ctx.getStatusline,
    setStatusline: ctx.setStatusline,
    invokeSkill: ctx.invokeSkill,
    listSkills: ctx.listSkills,
    listSlashCommands: ctx.listSlashCommands,
  };
}

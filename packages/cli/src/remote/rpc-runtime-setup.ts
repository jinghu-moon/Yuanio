import { rpcRegistry } from "./rpc";
import { createRpcRuntime } from "./rpc-runtime";
import {
  createMemoryRpcProviders,
  createAgentRpcProviders,
  createPolicyRpcProviders,
  createOutputStyleRpcProviders,
} from "./rpc-runtime-providers";
import {
  createRpcRuntimeContext,
  type CreateRpcRuntimeContextOptions,
} from "./rpc-runtime-context";
import { setStatuslineConfig } from "./statusline";
import { discoverSkills, listSlashCommandFiles } from "./skill-engine";
import type {
  PermissionRuleSet,
  SandboxPolicy,
} from "./permission-policy";

export interface CreateRpcRuntimeSetupOptions {
  sendEnvelope: CreateRpcRuntimeContextOptions["sendEnvelope"];
  refreshProjectScopedConfig: CreateRpcRuntimeContextOptions["refreshProjectScopedConfig"];
  runConfigChangeHook: (ctx: Record<string, unknown>) => Promise<unknown>;
  getCwd: () => string;
  getSessionId: () => string;
  emitCwdChangedStatus: CreateRpcRuntimeContextOptions["emitCwdChangedStatus"];
  heartbeatTick: CreateRpcRuntimeContextOptions["heartbeatTick"];
  getForegroundProbe: CreateRpcRuntimeContextOptions["getForegroundProbe"];
  getExecutionMode: CreateRpcRuntimeContextOptions["getExecutionMode"];
  setExecutionMode: CreateRpcRuntimeContextOptions["setExecutionMode"];
  getPermissionMode: CreateRpcRuntimeContextOptions["getPermissionMode"];
  setPermissionModeByRpc: CreateRpcRuntimeContextOptions["setPermissionModeByRpc"];
  listCheckpoints: CreateRpcRuntimeContextOptions["listCheckpoints"];
  restoreCheckpointById: CreateRpcRuntimeContextOptions["restoreCheckpointById"];
  runningAgents: CreateRpcRuntimeContextOptions["runningAgents"];
  getQueueSize: () => number;
  getPendingApprovalsSize: () => number;
  getContextUsage: CreateRpcRuntimeContextOptions["getContextUsage"];
  compactContext: CreateRpcRuntimeContextOptions["compactContext"];
  resolveCheckpointTarget: CreateRpcRuntimeContextOptions["resolveCheckpointTarget"];
  rewindToMessage: CreateRpcRuntimeContextOptions["rewindToMessage"];
  taskRegistry: CreateRpcRuntimeContextOptions["taskRegistry"];
  getPermissionRulesRef: () => PermissionRuleSet;
  setPermissionRulesRef: (next: PermissionRuleSet) => void;
  getSandboxPolicyRef: () => SandboxPolicy;
  setSandboxPolicyRef: (next: SandboxPolicy) => void;
  renderStatusline: CreateRpcRuntimeContextOptions["getStatusline"];
  invokeSkill: (name: string, args?: string) => Promise<unknown> | unknown;
}

export function createRpcRuntimeSetup(options: CreateRpcRuntimeSetupOptions) {
  const rpcDepsContext = createRpcRuntimeContext({
    sendEnvelope: options.sendEnvelope,
    refreshProjectScopedConfig: options.refreshProjectScopedConfig,
    runConfigChangeHook: options.runConfigChangeHook,
    getCwd: options.getCwd,
    getSessionId: options.getSessionId,
    emitCwdChangedStatus: options.emitCwdChangedStatus,
    heartbeatTick: options.heartbeatTick,
    getForegroundProbe: options.getForegroundProbe,
    getExecutionMode: options.getExecutionMode,
    setExecutionMode: options.setExecutionMode,
    getPermissionMode: options.getPermissionMode,
    setPermissionModeByRpc: options.setPermissionModeByRpc,
    listCheckpoints: options.listCheckpoints,
    restoreCheckpointById: options.restoreCheckpointById,
    runningAgents: options.runningAgents,
    getQueueSize: options.getQueueSize,
    getPendingApprovalsSize: options.getPendingApprovalsSize,
    getContextUsage: options.getContextUsage,
    compactContext: options.compactContext,
    resolveCheckpointTarget: options.resolveCheckpointTarget,
    rewindToMessage: options.rewindToMessage,
    taskRegistry: options.taskRegistry,
    ...createMemoryRpcProviders(options.getCwd),
    ...createAgentRpcProviders(options.getCwd),
    ...createPolicyRpcProviders(
      options.getCwd,
      options.getPermissionRulesRef,
      options.setPermissionRulesRef,
      options.getSandboxPolicyRef,
      options.setSandboxPolicyRef,
    ),
    ...createOutputStyleRpcProviders(options.getCwd),
    getStatusline: options.renderStatusline,
    setStatusline: (input) => setStatuslineConfig(input, options.getCwd()),
    invokeSkill: options.invokeSkill,
    listSkills: () => discoverSkills(options.getCwd()),
    listSlashCommands: () => listSlashCommandFiles(options.getCwd()),
  });

  return createRpcRuntime({
    depsContext: rpcDepsContext,
    dispatchRpc: (method, params, deps) => rpcRegistry.dispatch(method, params, deps),
  });
}

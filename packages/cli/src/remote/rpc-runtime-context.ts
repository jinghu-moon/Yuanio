import type { RpcDepsFactoryContext } from "./rpc-deps-factory";

interface TaskRegistryLike {
  list: (limit?: number) => unknown[];
  get: (taskId: string) => {
    taskId: string;
    promptId: string;
    status: string;
    outputLines: string[];
  } | null;
  stop: (taskId: string) => boolean;
}

interface RunningAgentLike {
  agent: string;
}

export interface CreateRpcRuntimeContextOptions {
  sendEnvelope: RpcDepsFactoryContext["sendEnvelope"];
  refreshProjectScopedConfig: RpcDepsFactoryContext["refreshProjectScopedConfig"];
  runConfigChangeHook: (ctx: Record<string, unknown>) => Promise<unknown>;
  getCwd: () => string;
  getSessionId: () => string;
  emitCwdChangedStatus: RpcDepsFactoryContext["emitCwdChangedStatus"];
  heartbeatTick: RpcDepsFactoryContext["heartbeatTick"];
  getForegroundProbe: RpcDepsFactoryContext["getForegroundProbe"];
  getExecutionMode: RpcDepsFactoryContext["getExecutionMode"];
  setExecutionMode: RpcDepsFactoryContext["setExecutionMode"];
  getPermissionMode: RpcDepsFactoryContext["getPermissionMode"];
  setPermissionModeByRpc: RpcDepsFactoryContext["setPermissionModeByRpc"];
  listCheckpoints: RpcDepsFactoryContext["listCheckpoints"];
  restoreCheckpointById: RpcDepsFactoryContext["restoreCheckpointById"];
  runningAgents: Map<string, RunningAgentLike>;
  getQueueSize: () => number;
  getPendingApprovalsSize: () => number;
  getContextUsage: RpcDepsFactoryContext["getContextUsage"];
  compactContext: RpcDepsFactoryContext["compactContext"];
  resolveCheckpointTarget: RpcDepsFactoryContext["resolveCheckpointTarget"];
  rewindToMessage: RpcDepsFactoryContext["rewindToMessage"];
  taskRegistry: TaskRegistryLike;
  getMemoryStatus: RpcDepsFactoryContext["getMemoryStatus"];
  setMemoryEnabled: RpcDepsFactoryContext["setMemoryEnabled"];
  addMemoryNote: RpcDepsFactoryContext["addMemoryNote"];
  listAgents: RpcDepsFactoryContext["listAgents"];
  saveAgent: RpcDepsFactoryContext["saveAgent"];
  deleteAgent: RpcDepsFactoryContext["deleteAgent"];
  getPermissionRules: RpcDepsFactoryContext["getPermissionRules"];
  setPermissionRules: RpcDepsFactoryContext["setPermissionRules"];
  getSandboxPolicy: RpcDepsFactoryContext["getSandboxPolicy"];
  setSandboxPolicy: RpcDepsFactoryContext["setSandboxPolicy"];
  listOutputStyles: RpcDepsFactoryContext["listOutputStyles"];
  getOutputStyle: RpcDepsFactoryContext["getOutputStyle"];
  setOutputStyle: RpcDepsFactoryContext["setOutputStyle"];
  getStatusline: RpcDepsFactoryContext["getStatusline"];
  setStatusline: RpcDepsFactoryContext["setStatusline"];
  invokeSkill: RpcDepsFactoryContext["invokeSkill"];
  listSkills: RpcDepsFactoryContext["listSkills"];
  listSlashCommands: RpcDepsFactoryContext["listSlashCommands"];
}

export function createRpcRuntimeContext(options: CreateRpcRuntimeContextOptions): RpcDepsFactoryContext {
  return {
    sendEnvelope: options.sendEnvelope,
    refreshProjectScopedConfig: options.refreshProjectScopedConfig,
    runProjectSwitchedHook: async (projectSwitchMethod?: string) => {
      const hookContext: Record<string, unknown> = {
        event: "project_switched",
        cwd: options.getCwd(),
        sessionId: options.getSessionId(),
      };
      if (projectSwitchMethod) hookContext.method = projectSwitchMethod;
      await options.runConfigChangeHook(hookContext);
    },
    emitCwdChangedStatus: options.emitCwdChangedStatus,
    heartbeatTick: options.heartbeatTick,
    getForegroundProbe: options.getForegroundProbe,
    getExecutionMode: options.getExecutionMode,
    setExecutionMode: options.setExecutionMode,
    getPermissionMode: options.getPermissionMode,
    setPermissionModeByRpc: options.setPermissionModeByRpc,
    listCheckpoints: options.listCheckpoints,
    restoreCheckpointById: options.restoreCheckpointById,
    getTaskPanel: () => ({
      mode: options.getExecutionMode(),
      runningCount: options.runningAgents.size,
      queueSize: options.getQueueSize(),
      running: Array.from(options.runningAgents.entries()).map(([taskId, meta]) => ({
        taskId,
        agent: meta.agent,
      })),
      pendingApprovals: options.getPendingApprovalsSize(),
    }),
    getContextUsage: options.getContextUsage,
    compactContext: options.compactContext,
    resolveCheckpointTarget: options.resolveCheckpointTarget,
    rewindToMessage: options.rewindToMessage,
    listTasks: (limit) => options.taskRegistry.list(limit),
    getTaskOutput: (taskId) => {
      const item = options.taskRegistry.get(taskId);
      if (!item) return null;
      return {
        taskId: item.taskId,
        promptId: item.promptId,
        status: item.status,
        outputLines: item.outputLines,
        output: item.outputLines.join("\n"),
      };
    },
    stopTask: (taskId) => options.taskRegistry.stop(taskId),
    getMemoryStatus: options.getMemoryStatus,
    setMemoryEnabled: options.setMemoryEnabled,
    addMemoryNote: options.addMemoryNote,
    listAgents: options.listAgents,
    saveAgent: options.saveAgent,
    deleteAgent: options.deleteAgent,
    getPermissionRules: options.getPermissionRules,
    setPermissionRules: options.setPermissionRules,
    getSandboxPolicy: options.getSandboxPolicy,
    setSandboxPolicy: options.setSandboxPolicy,
    listOutputStyles: options.listOutputStyles,
    getOutputStyle: options.getOutputStyle,
    setOutputStyle: options.setOutputStyle,
    getStatusline: options.getStatusline,
    setStatusline: options.setStatusline,
    invokeSkill: options.invokeSkill,
    listSkills: options.listSkills,
    listSlashCommands: options.listSlashCommands,
  };
}

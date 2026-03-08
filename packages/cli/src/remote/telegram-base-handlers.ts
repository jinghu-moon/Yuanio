type ExecutionMode = "act" | "plan";

export interface TelegramBaseHandlersContext {
  sendPrompt: (prompt: string) => Promise<void>;
  sendContinue: () => Promise<void>;
  stopTasks: (reason: string) => Promise<void>;
  clearTasksAndQueue: (reason: string) => Promise<{ runningCount: number; clearedQueue: number }>;
  buildLoopPrompt: (prompt: string) => string;
  loopMaxIterations: number;
  getStatusSnapshot: () => {
    status: string;
    executionMode: ExecutionMode;
    autoTestGateEnabled: boolean;
    autoTestGateCmd: string;
    runningTasks: number;
    pendingApprovals: number;
    cwd: string;
    turnStateVersion: number;
    turnStateReason: string;
    sessionId: string;
  };
  setExecutionMode: (
    mode: ExecutionMode,
    source: "telegram" | "app" | "system",
  ) => Promise<string>;
  formatRunningTasksPanel: () => string;
  listTaskHistoryText: (args: string[]) => Promise<string>;
  listCheckpointText: () => string;
  restoreCheckpointById: (checkpointId: string) => Promise<string>;
}

export function createTelegramBaseHandlers(ctx: TelegramBaseHandlersContext) {
  return {
    onPrompt: async (prompt: string): Promise<void> => {
      await ctx.sendPrompt(prompt);
    },

    onContinue: async (): Promise<void> => {
      await ctx.sendContinue();
    },

    onStop: async (): Promise<void> => {
      await ctx.stopTasks("telegram stop");
    },

    onClear: async (): Promise<string> => {
      const { runningCount, clearedQueue } = await ctx.clearTasksAndQueue("telegram clear");
      return `已清理：中止任务 ${runningCount} 个，清空队列 ${clearedQueue} 条`;
    },

    onLoop: async (prompt: string): Promise<string> => {
      await ctx.sendPrompt(ctx.buildLoopPrompt(prompt));
      return `已启动循环任务（最多 ${ctx.loopMaxIterations} 轮）`;
    },

    onStatus: async (): Promise<string> => {
      const snap = ctx.getStatusSnapshot();
      return [
        `状态: ${snap.status}`,
        `执行模式: ${snap.executionMode.toUpperCase()}`,
        `自动测试: ${snap.autoTestGateEnabled && snap.autoTestGateCmd ? `ON (${snap.autoTestGateCmd})` : "OFF"}`,
        `运行中任务: ${snap.runningTasks}`,
        `待审批: ${snap.pendingApprovals}`,
        `工作目录: ${snap.cwd}`,
        `Turn: v${snap.turnStateVersion} (${snap.turnStateReason})`,
        `会话: ${snap.sessionId.slice(0, 8)}...`,
      ].join("\n");
    },

    onMode: async (mode?: string): Promise<string> => {
      const normalized = (mode || "").trim().toLowerCase();
      if (!normalized) {
        return [
          `当前执行模式: ${ctx.getStatusSnapshot().executionMode.toUpperCase()}`,
          "用法: /mode plan 或 /mode act",
        ].join("\n");
      }
      if (normalized !== "plan" && normalized !== "act") {
        return `不支持的模式: ${mode}`;
      }
      return ctx.setExecutionMode(normalized as ExecutionMode, "telegram");
    },

    onTasks: async (): Promise<string> => {
      return ctx.formatRunningTasksPanel();
    },

    onHistory: async (args: string[]): Promise<string> => {
      return ctx.listTaskHistoryText(args);
    },

    onCheckpointList: async (): Promise<string> => {
      return ctx.listCheckpointText();
    },

    onCheckpointRestore: async (checkpointId: string): Promise<string> => {
      return ctx.restoreCheckpointById(checkpointId);
    },
  };
}

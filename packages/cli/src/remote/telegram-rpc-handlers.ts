export type DispatchRpcForTelegram = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<{ result?: unknown; error?: string; errorCode?: string }>;

interface ForegroundProbeSnapshotLike {
  status: string;
  cwd: string;
  runningTasks?: number;
  pendingApprovals?: number;
  turnStateVersion?: number;
  turnStateReason?: string;
}

export interface TelegramRpcHandlersContext {
  dispatchRpcForTelegram: DispatchRpcForTelegram;
  renderTaskOutputText: (value: unknown) => string;
  clampTextForTelegram: (value: string, maxChars?: number) => string;
  contextWindowSize: number;
  getRunningAgentsSize: () => number;
  getQueueSize: () => number;
  getCompactSummariesCount: () => number;
  getForegroundProbeSnapshot: () => ForegroundProbeSnapshotLike;
}

export function createTelegramRpcHandlers(ctx: TelegramRpcHandlersContext) {
  return {
    onTask: async (args: string[]): Promise<string> => {
      const taskId = String(args[0] || "").trim();
      if (!taskId) return "用法: /task <taskId>";
      const { result, error } = await ctx.dispatchRpcForTelegram("task_output", { taskId });
      if (error) return `task 查询失败: ${error}`;
      const data = (result ?? {}) as Record<string, unknown>;
      const status = String(data.status || "unknown");
      const promptId = String(data.promptId || "");
      const outputText = ctx.renderTaskOutputText(data.output || data.outputLines);
      const lines = [
        `任务详情: ${taskId}`,
        `status: ${status}`,
        promptId ? `promptId: ${promptId}` : undefined,
        outputText ? "" : "(no output)",
        outputText ? ctx.clampTextForTelegram(outputText, 3000) : undefined,
      ].filter((line): line is string => typeof line === "string");
      return lines.join("\n");
    },

    onContextUsage: async (): Promise<string> => {
      const { result, error } = await ctx.dispatchRpcForTelegram("context_usage", {});
      if (error) return `context 查询失败: ${error}`;
      const info = (result ?? {}) as Record<string, unknown>;
      return [
        "Context Usage",
        `used: ${Number(info.usedPercentage ?? 0)}%`,
        `tokens: ${Number(info.estimatedUsedTokens ?? 0)} / ${Number(info.contextWindowSize ?? ctx.contextWindowSize)}`,
        `running: ${Number(info.runningTasks ?? ctx.getRunningAgentsSize())} · queue: ${Number(info.queuedTasks ?? ctx.getQueueSize())}`,
        `compact: ${Number(info.compactCount ?? ctx.getCompactSummariesCount())}`,
      ].join("\n");
    },

    onCompactContext: async (instructions?: string): Promise<string> => {
      const { result, error } = await ctx.dispatchRpcForTelegram("compact_context", {
        instructions: instructions || "",
      });
      if (error) return `compact 触发失败: ${error}`;
      const data = (result ?? {}) as Record<string, unknown>;
      return [
        "compact 已触发",
        `promptId: ${String(data.promptId || "(unknown)")}`,
        typeof data.prompt === "string" ? `prompt: ${String(data.prompt).slice(0, 220)}` : undefined,
      ].filter(Boolean).join("\n");
    },

    onMemory: async (args: string[]): Promise<string> => {
      const action = (args[0] || "status").toLowerCase();
      if (action === "status" || action === "show") {
        const { result, error } = await ctx.dispatchRpcForTelegram("memory_status", {});
        if (error) return `memory 查询失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        const autoFiles = Array.isArray(data.autoMemoryFiles) ? data.autoMemoryFiles as string[] : [];
        return [
          `memory: ${data.autoMemoryEnabled ? "ON" : "OFF"}`,
          `root: ${String(data.autoMemoryRoot || "")}`,
          `files: ${autoFiles.length}`,
        ].join("\n");
      }
      if (action === "on" || action === "off") {
        const { result, error } = await ctx.dispatchRpcForTelegram("memory_toggle", { enabled: action === "on" });
        if (error) return `memory 切换失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return `memory 已切换: ${data.enabled ? "ON" : "OFF"}`;
      }
      if (action === "add") {
        const note = args.slice(1).join(" ").trim();
        if (!note) return "用法: /memory add <note>";
        const { result, error } = await ctx.dispatchRpcForTelegram("memory_add_note", { note });
        if (error) return `memory 追加失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return `memory 已追加: ${String(data.file || "")}`;
      }
      return "用法: /memory status|on|off|add <note>";
    },

    onAgents: async (args: string[]): Promise<string> => {
      const action = (args[0] || "list").toLowerCase();
      if (action === "delete" || action === "rm") {
        const name = args[1] || "";
        if (!name) return "用法: /agents delete <name>";
        const { result, error } = await ctx.dispatchRpcForTelegram("delete_agent", { name });
        if (error) return `删除 agent 失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return `agent ${name}: ${data.deleted ? "deleted" : "not found"}`;
      }
      const { result, error } = await ctx.dispatchRpcForTelegram("list_agents", {});
      if (error) return `agents 查询失败: ${error}`;
      const items = ((result as { items?: Array<Record<string, unknown>> } | null)?.items) || [];
      if (items.length === 0) return "暂无 agent 配置";
      const lines = ["Agents"];
      for (const item of items.slice(0, 12)) {
        lines.push(`- ${String(item.name || "unknown")}: ${String(item.description || "")}`);
      }
      return lines.join("\n");
    },

    onStyle: async (args: string[]): Promise<string> => {
      const action = (args[0] || "show").toLowerCase();
      if (action === "set") {
        const styleId = (args[1] || "").trim();
        if (!styleId) return "用法: /style set <styleId>";
        const { result, error } = await ctx.dispatchRpcForTelegram("set_output_style", { styleId });
        if (error) return `style 切换失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return `style 已切换: ${String(data.styleId || styleId)}`;
      }
      if (action === "list") {
        const { result, error } = await ctx.dispatchRpcForTelegram("list_output_styles", {});
        if (error) return `style 列表失败: ${error}`;
        const items = ((result as { items?: Array<Record<string, unknown>> } | null)?.items) || [];
        if (items.length === 0) return "暂无输出风格";
        return [
          "Output Styles",
          ...items.slice(0, 20).map((item) => `- ${String(item.id || "unknown")} (${String(item.source || "builtin")})`),
        ].join("\n");
      }
      const { result, error } = await ctx.dispatchRpcForTelegram("get_output_style", {});
      if (error) return `style 查询失败: ${error}`;
      const data = (result ?? {}) as Record<string, unknown>;
      return [
        `当前 style: ${String(data.id || "default")}`,
        String(data.description || ""),
      ].join("\n");
    },

    onPermissions: async (args: string[]): Promise<string> => {
      const action = (args[0] || "show").toLowerCase();
      if (action === "sandbox") {
        const { result, error } = await ctx.dispatchRpcForTelegram("get_sandbox_policy", {});
        if (error) return `sandbox 查询失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return [
          `sandbox: ${data.enabled ? "ON" : "OFF"}`,
          `allowUnsandboxedCommands: ${data.allowUnsandboxedCommands ? "true" : "false"}`,
          `allowedDomains: ${Array.isArray(data.allowedDomains) ? (data.allowedDomains as string[]).join(", ") : ""}`,
        ].join("\n");
      }
      const { result, error } = await ctx.dispatchRpcForTelegram("get_permissions", {});
      if (error) return `permissions 查询失败: ${error}`;
      const data = (result ?? {}) as Record<string, unknown>;
      const allow = Array.isArray(data.allow) ? data.allow as string[] : [];
      const ask = Array.isArray(data.ask) ? data.ask as string[] : [];
      const deny = Array.isArray(data.deny) ? data.deny as string[] : [];
      return [
        "Permission Rules",
        `allow(${allow.length}): ${allow.slice(0, 6).join(", ")}`,
        `ask(${ask.length}): ${ask.slice(0, 6).join(", ")}`,
        `deny(${deny.length}): ${deny.slice(0, 6).join(", ")}`,
      ].join("\n");
    },

    onStatusline: async (args: string[]): Promise<string> => {
      const action = (args[0] || "show").toLowerCase();
      if (action === "on" || action === "off") {
        const { result, error } = await ctx.dispatchRpcForTelegram("set_statusline", { enabled: action === "on" });
        if (error) return `statusline 设置失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return `statusline: ${data.enabled ? "ON" : "OFF"}`;
      }
      if (action === "set") {
        const command = args.slice(1).join(" ").trim();
        if (!command) return "用法: /statusline set <command>";
        const { result, error } = await ctx.dispatchRpcForTelegram("set_statusline", { command, enabled: true });
        if (error) return `statusline 设置失败: ${error}`;
        const data = (result ?? {}) as Record<string, unknown>;
        return [
          `statusline: ${data.enabled ? "ON" : "OFF"}`,
          `command: ${String(data.command || "")}`,
        ].join("\n");
      }
      const { result, error } = await ctx.dispatchRpcForTelegram("get_statusline", {});
      if (error) return `statusline 查询失败: ${error}`;
      return String((result as { text?: string } | null)?.text || "(empty)");
    },

    onCwd: async (path?: string): Promise<string> => {
      const target = path?.trim();
      if (!target) {
        return [
          `当前工作目录: ${process.cwd()}`,
          "用法: /cwd <path>",
        ].join("\n");
      }

      const { result, error } = await ctx.dispatchRpcForTelegram("change_cwd", { path: target });
      if (error) return `切换失败: ${error}`;

      const info = (result ?? {}) as {
        cwd?: string;
        parent?: string | null;
        entries?: Array<{ name?: string }>;
      };
      const dirs = Array.isArray(info.entries)
        ? info.entries.map((item) => item?.name).filter((name): name is string => !!name).slice(0, 6)
        : [];
      return [
        "已切换工作目录",
        `cwd: ${info.cwd || process.cwd()}`,
        info.parent ? `parent: ${info.parent}` : undefined,
        dirs.length > 0 ? `子目录: ${dirs.join(", ")}` : "子目录: (empty)",
      ].filter(Boolean).join("\n");
    },

    onProbe: async (): Promise<string> => {
      const fallback = ctx.getForegroundProbeSnapshot();
      const { result, error } = await ctx.dispatchRpcForTelegram("foreground_probe", {});
      if (error) {
        return [
          `探活失败: ${error}`,
          `fallback status: ${String(fallback.status)}`,
          `cwd: ${String(fallback.cwd)}`,
        ].join("\n");
      }
      const snap = (result ?? fallback) as Record<string, unknown>;
      const serverTs = typeof snap.serverTs === "number" ? snap.serverTs : Date.now();
      const dateText = new Date(serverTs).toLocaleString("zh-CN", { hour12: false });
      return [
        "探活成功",
        `时间: ${dateText}`,
        `状态: ${String(snap.status ?? fallback.status)}`,
        `cwd: ${String(snap.cwd ?? fallback.cwd)}`,
        `运行中任务: ${Number(snap.runningTasks ?? fallback.runningTasks ?? 0)}`,
        `待审批: ${Number(snap.pendingApprovals ?? fallback.pendingApprovals ?? 0)}`,
        `Turn: v${Number(snap.turnStateVersion ?? fallback.turnStateVersion ?? 0)} (${String(snap.turnStateReason ?? fallback.turnStateReason ?? "unknown")})`,
      ].join("\n");
    },
  };
}

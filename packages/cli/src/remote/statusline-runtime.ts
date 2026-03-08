import type { AgentStatus } from "@yuanio/shared";
import { getCurrentOutputStyle } from "./output-style";
import {
  getStatuslineConfig,
  runStatuslineCommand,
  buildDefaultStatuslineText,
  type StatuslineInput,
} from "./statusline";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ContextUsageSnapshot {
  usedPercentage: number;
  estimatedUsedTokens: number;
  contextWindowSize: number;
  runningTasks: number;
  queuedTasks: number;
  compactCount: number;
}

export interface CreateStatuslineRuntimeOptions {
  getCwd: () => string;
  getSessionId: () => string;
  getStatus: () => AgentStatus;
  getExecutionMode: () => "act" | "plan";
  getRunningTasks: () => number;
  getPendingApprovals: () => number;
  getQueueSize: () => number;
  getUptimeMs: () => number;
  getUsageTotals: () => UsageTotals;
  getContextWindowSize: () => number;
  getCompactCount: () => number;
}

export function createStatuslineRuntime(options: CreateStatuslineRuntimeOptions) {
  const getContextUsage = (): ContextUsageSnapshot => {
    const totals = options.getUsageTotals();
    const estimatedUsedTokens = totals.inputTokens
      + totals.outputTokens
      + totals.cacheCreationTokens
      + totals.cacheReadTokens;
    const contextWindowSize = options.getContextWindowSize();
    const usedPercentage = Math.max(
      0,
      Math.min(100, Math.round((estimatedUsedTokens / Math.max(1, contextWindowSize)) * 100)),
    );

    return {
      usedPercentage,
      estimatedUsedTokens,
      contextWindowSize,
      runningTasks: options.getRunningTasks(),
      queuedTasks: options.getQueueSize(),
      compactCount: options.getCompactCount(),
    };
  };

  const renderStatusline = async (): Promise<string> => {
    const context = getContextUsage();
    const cwd = options.getCwd();
    const outputStyle = getCurrentOutputStyle(cwd);
    const input: StatuslineInput = {
      cwd,
      projectDir: cwd,
      sessionId: options.getSessionId(),
      status: options.getStatus(),
      mode: options.getExecutionMode(),
      runningTasks: options.getRunningTasks(),
      pendingApprovals: options.getPendingApprovals(),
      queueSize: options.getQueueSize(),
      outputStyle: outputStyle.id,
      uptimeMs: options.getUptimeMs(),
      cost: options.getUsageTotals(),
      context,
    };
    const config = getStatuslineConfig(cwd);
    if (!config.enabled) return "(statusline disabled)";
    if (config.command) {
      const rendered = await runStatuslineCommand(config.command, input);
      if (rendered && rendered.trim()) return rendered.trim();
    }
    return buildDefaultStatuslineText(input);
  };

  return {
    getContextUsage,
    renderStatusline,
  };
}

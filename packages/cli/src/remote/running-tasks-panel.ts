interface RunningAgentLike {
  agent: string;
}

export interface FormatRunningTasksPanelOptions {
  mode: "act" | "plan";
  runningAgents: Map<string, RunningAgentLike>;
  queueSize: number;
  pendingApprovals: number;
}

export function formatRunningTasksPanel(options: FormatRunningTasksPanelOptions): string {
  const running = Array.from(options.runningAgents.entries()).map(([id, value]) => `${id} · ${value.agent}`);
  const lines = [
    "并发任务面板",
    `模式: ${options.mode.toUpperCase()}`,
    `运行中: ${options.runningAgents.size}`,
    "任务:",
    `离线队列: ${options.queueSize}`,
    `待审批: ${options.pendingApprovals}`,
  ];
  if (running.length > 0) {
    lines.push(...running.slice(0, 12).map((line) => `- ${line}`));
  } else {
    lines.push("- (empty)");
  }
  return lines.join("\n");
}

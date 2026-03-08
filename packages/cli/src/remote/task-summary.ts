import type { TaskSummaryPayload, UsageInfo } from "@yuanio/shared";

export async function collectTaskSummary(
  taskId: string,
  taskStartMap: Map<string, number>,
  taskUsageMap: Map<string, UsageInfo>,
): Promise<TaskSummaryPayload> {
  const startedAt = taskStartMap.get(taskId) ?? Date.now();
  const duration = Date.now() - startedAt;
  const usage = taskUsageMap.get(taskId);

  const summary: TaskSummaryPayload = { taskId, duration };

  try {
    const statProc = Bun.spawn(
      ["git", "diff", "--stat", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stat = await new Response(statProc.stdout).text();

    const numProc = Bun.spawn(
      ["git", "diff", "--numstat", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const numstat = await new Response(numProc.stdout).text();

    if (stat.trim()) {
      let insertions = 0;
      let deletions = 0;
      let filesChanged = 0;
      for (const line of numstat.trim().split("\n")) {
        const [add, del] = line.split("\t");
        if (add !== "-") insertions += Number(add) || 0;
        if (del !== "-") deletions += Number(del) || 0;
        filesChanged++;
      }
      summary.gitDiff = {
        stat: stat.trim(),
        filesChanged,
        insertions,
        deletions,
      };
    }
  } catch {
    // 非 git 仓库或 git 不可用，忽略
  }

  if (usage) summary.usage = usage;
  return summary;
}

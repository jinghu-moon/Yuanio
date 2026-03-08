type DispatchRpcForTelegram = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<{ result?: unknown; error?: string; errorCode?: string }>;

export async function handleTelegramRewindCommand(
  target: string,
  dryRun: boolean | undefined,
  dispatchRpcForTelegram: DispatchRpcForTelegram,
): Promise<string> {
  if (dryRun) {
    const { result, error } = await dispatchRpcForTelegram("rewind_preview", { target });
    if (error) return `rewind 预览失败: ${error}`;
    const info = (result ?? {}) as Record<string, unknown>;
    if (info.found !== true) return `未找到 rewind 目标: ${target}`;
    const files = Array.isArray(info.files) ? info.files as string[] : [];
    return [
      "rewind 预览",
      `checkpoint: ${String(info.checkpointId || "")}`,
      info.promptId ? `promptId: ${String(info.promptId)}` : undefined,
      `files: ${files.length}`,
      files.length > 0 ? files.slice(0, 8).join("\n") : undefined,
    ].filter(Boolean).join("\n");
  }

  const { result, error } = await dispatchRpcForTelegram("rewind_to_message", { target, dryRun: false });
  if (error) return `rewind 执行失败: ${error}`;
  const info = (result ?? {}) as Record<string, unknown>;
  const failed = Array.isArray(info.failedFiles) ? info.failedFiles as string[] : [];
  const ok = Array.isArray(info.successFiles) ? info.successFiles as string[] : [];
  return [
    `rewind 执行完成: ${String(info.checkpointId || target)}`,
    `成功: ${ok.length}`,
    `失败: ${failed.length}`,
    failed.length > 0 ? `失败文件: ${failed.slice(0, 8).join(", ")}` : undefined,
  ].filter(Boolean).join("\n");
}

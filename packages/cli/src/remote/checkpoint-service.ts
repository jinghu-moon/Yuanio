import { MessageType } from "@yuanio/shared";
import type { AgentStatus } from "@yuanio/shared";
import type { CheckpointItem } from "./checkpoints";

type CheckpointStoreLike = {
  list: (limit?: number) => CheckpointItem[];
  get: (id: string) => CheckpointItem | null;
  findByPromptId: (promptId: string) => CheckpointItem | null;
};

type RollbackResult = {
  ok: string[];
  failed: string[];
};

type RewindResult =
  | { ok: false; target: string; reason: "not_found" }
  | { ok: false; target: string; checkpointId: string; promptId?: string; reason: "no_files" }
  | { ok: true; dryRun: true; target: string; checkpointId: string; promptId?: string; files: string[] }
  | {
    ok: boolean;
    dryRun: false;
    target: string;
    checkpointId: string;
    promptId?: string;
    successFiles: string[];
    failedFiles: string[];
  };

export interface CheckpointServiceContext {
  checkpointStore: CheckpointStoreLike;
  rollbackFiles: (paths: string[]) => Promise<RollbackResult>;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  emitStatusAndTurnState: (
    nextStatus: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
}

export function createCheckpointService(ctx: CheckpointServiceContext) {
  const listCheckpointText = (): string => {
    const items = ctx.checkpointStore.list(10);
    if (items.length === 0) return "暂无 checkpoint";
    const lines = ["Checkpoint 时间线（最近 10 条）"];
    for (const item of items) {
      const time = new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false });
      lines.push(`- ${item.id}`);
      lines.push(`  ${time} · ${item.agent} · files=${item.files.length}`);
      if (item.promptId) lines.push(`  promptId=${item.promptId}`);
      lines.push(`  ${item.promptPreview}`);
    }
    lines.push("恢复命令: /checkpoint restore <id>");
    return lines.join("\n");
  };

  const resolveCheckpointTarget = (target: string): CheckpointItem | null => {
    const normalized = target.trim();
    if (!normalized) return null;
    return ctx.checkpointStore.get(normalized) || ctx.checkpointStore.findByPromptId(normalized);
  };

  const rewindToTarget = async (target: string, dryRun = false): Promise<RewindResult> => {
    const item = resolveCheckpointTarget(target);
    if (!item) {
      return {
        ok: false,
        target,
        reason: "not_found",
      };
    }
    if (item.files.length === 0) {
      return {
        ok: false,
        target,
        checkpointId: item.id,
        promptId: item.promptId,
        reason: "no_files",
      };
    }
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        target,
        checkpointId: item.id,
        promptId: item.promptId,
        files: item.files.slice(0, 100),
      };
    }

    const { ok, failed } = await ctx.rollbackFiles(item.files);
    for (const path of ok) {
      await ctx.sendEnvelope(MessageType.DIFF_ACTION_RESULT, JSON.stringify({
        path,
        action: "rollback",
        success: true,
      }));
    }
    for (const path of failed) {
      await ctx.sendEnvelope(MessageType.DIFF_ACTION_RESULT, JSON.stringify({
        path,
        action: "rollback",
        success: false,
        error: "git checkout failed",
      }));
    }
    await ctx.emitStatusAndTurnState(failed.length > 0 ? "error" : "idle", "checkpoint_restore", true);
    return {
      ok: failed.length === 0,
      dryRun: false,
      target,
      checkpointId: item.id,
      promptId: item.promptId,
      successFiles: ok,
      failedFiles: failed,
    };
  };

  const restoreCheckpointById = async (checkpointId: string): Promise<string> => {
    const result = await rewindToTarget(checkpointId, false);
    if (!result.ok && "reason" in result && result.reason === "not_found") return `未找到 checkpoint: ${checkpointId}`;
    if (!result.ok && "reason" in result && result.reason === "no_files") {
      const noFileCheckpointId = "checkpointId" in result ? result.checkpointId : checkpointId;
      return `checkpoint ${noFileCheckpointId || checkpointId} 无可回滚文件`;
    }
    const finalCheckpointId = "checkpointId" in result ? result.checkpointId : checkpointId;
    const successFiles = "successFiles" in result ? result.successFiles : [];
    const failedFiles = "failedFiles" in result ? result.failedFiles : [];
    const promptId = "promptId" in result ? result.promptId : undefined;
    const lines = [
      `checkpoint 回滚完成: ${finalCheckpointId || checkpointId}`,
      `成功: ${successFiles.length || 0}`,
      `失败: ${failedFiles.length || 0}`,
    ];
    if (promptId) lines.push(`promptId: ${promptId}`);
    if (failedFiles.length > 0) {
      lines.push(`失败文件: ${failedFiles.slice(0, 8).join(", ")}`);
    }
    return lines.join("\n");
  };

  return {
    listCheckpointText,
    resolveCheckpointTarget,
    rewindToTarget,
    restoreCheckpointById,
  };
}

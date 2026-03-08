import { MessageType, type AgentStatus, type IngressPromptSource } from "@yuanio/shared";
import type { PromptTaskReport } from "./prompt";
import { runTestGate, renderTestGateSummary } from "./test-gate";

interface HookRunResultLike {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
}

interface TaskRegistryLike {
  get: (taskId: string) => { status: string } | null;
  finish: (taskId: string, status: "completed" | "error", error?: string) => void;
}

interface CheckpointStoreLike {
  add: (input: {
    taskId: string;
    promptId?: string;
    agent: string;
    prompt: string;
    source?: IngressPromptSource;
    cwd: string;
    files: string[];
  }) => { id: string };
}

export interface CreateTaskFinishedHandlerOptions {
  taskRegistry: TaskRegistryLike;
  runTaskCompletedHook: (payload: Record<string, unknown>) => Promise<HookRunResultLike | null>;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  checkpointStore: CheckpointStoreLike;
  autoTestGateEnabled: boolean;
  autoTestGateCmd: string;
  autoTestGateTimeoutMs: number;
  emitStatusAndTurnState: (status: AgentStatus, reason?: string, force?: boolean) => Promise<void> | void;
  sendTelegram: (text: string) => Promise<void> | void;
}

export function createTaskFinishedHandler(options: CreateTaskFinishedHandlerOptions) {
  const emitTestGateHook = async (
    phase: "running" | "passed" | "failed",
    taskId: string,
    command: string,
    detail?: string,
  ) => {
    await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
      hook: "test_gate",
      event: phase,
      tool: command,
      taskId,
      detail,
    }));
  };

  return async (report: PromptTaskReport) => {
    const currentTask = options.taskRegistry.get(report.taskId);
    const completedHook = await options.runTaskCompletedHook({
      event: "task_completed",
      taskId: report.taskId,
      promptId: report.promptId,
      agent: report.agent,
      prompt: report.prompt,
      success: report.success,
      error: report.error,
      changedFiles: report.changedFiles,
      cwd: report.cwd,
      source: report.source,
    });
    if (completedHook?.blocked) {
      if (currentTask?.status !== "stopped") {
        options.taskRegistry.finish(report.taskId, "error", completedHook.reason || "blocked by TaskCompleted hook");
      }
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "TaskCompleted",
        event: "blocked",
        tool: "task",
        taskId: report.taskId,
        reason: completedHook.reason || "blocked by TaskCompleted hook",
      }));
      await options.emitStatusAndTurnState("error", "task_completed_hook_blocked", true);
      await options.sendTelegram(`[hook] TaskCompleted blocked: ${completedHook.reason || "unknown reason"}`);
      return;
    }

    if (currentTask?.status !== "stopped") {
      options.taskRegistry.finish(report.taskId, report.success ? "completed" : "error", report.error);
    }

    if (completedHook && completedHook.injectedContext.length > 0) {
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "TaskCompleted",
        event: "injected_context",
        tool: "task",
        taskId: report.taskId,
        detail: completedHook.injectedContext.slice(0, 2).join("\n"),
      }));
    }

    if (report.success && report.changedFiles.length > 0) {
      const checkpoint = options.checkpointStore.add({
        taskId: report.taskId,
        promptId: report.promptId,
        agent: report.agent,
        prompt: report.prompt,
        source: report.source === "unknown" ? undefined : report.source,
        cwd: report.cwd,
        files: report.changedFiles,
      });
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "checkpoint",
        event: "created",
        tool: "checkpoint",
        taskId: report.taskId,
        checkpointId: checkpoint.id,
        files: report.changedFiles.slice(0, 12),
      }));
    }

    const shouldRunTestGate = options.autoTestGateEnabled
      && report.success
      && report.changedFiles.length > 0
      && !!options.autoTestGateCmd;
    if (!shouldRunTestGate) return;

    await emitTestGateHook("running", report.taskId, options.autoTestGateCmd);
    const testResult = await runTestGate({
      taskId: report.taskId,
      command: options.autoTestGateCmd,
      cwd: report.cwd,
      timeoutMs: options.autoTestGateTimeoutMs,
    });
    const summary = renderTestGateSummary(testResult);
    await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
      hook: "test_gate",
      event: testResult.ok ? "passed" : "failed",
      tool: testResult.command,
      taskId: report.taskId,
      exitCode: testResult.exitCode,
      durationMs: testResult.durationMs,
      timedOut: testResult.timedOut,
    }));

    if (!testResult.ok) {
      await options.emitStatusAndTurnState("error", "autotest_failed", true);
      await options.sendTelegram(summary);
      return;
    }

    await options.sendTelegram(summary);
  };
}

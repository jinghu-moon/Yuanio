import { MessageType } from "@yuanio/shared";
import type {
  ToolCallPayload,
  FileDiffPayload,
  UsageReportPayload,
  UsageInfo,
  TodoUpdatePayload,
  ThinkingPayload,
} from "@yuanio/shared";
import type { NormalizedEvent } from "../adapters";
import { extractTodosFromAgentOutput } from "./todo-extractor";
import { eventBus } from "../event-bus";

const streamStatusToChunk = process.env.YUANIO_STREAM_STATUS === "1";

export async function dispatchEvent(
  ev: NormalizedEvent,
  agent: string,
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number) => Promise<void>,
  statusCount: number,
  taskId: string | undefined,
  taskUsageMap: Map<string, UsageInfo>,
): Promise<void> {
  switch (ev.kind) {
    case "text": {
      await sendEnvelope(MessageType.STREAM_CHUNK, ev.text);
      break;
    }

    case "thinking": {
      const payload: ThinkingPayload = {
        thinking: ev.thinking,
        turnId: ev.turnId,
        agent,
      };
      await sendEnvelope(MessageType.THINKING, JSON.stringify(payload));
      break;
    }

    case "tool_call": {
      const payload: ToolCallPayload = {
        tool: ev.tool,
        params: ev.params,
        status: ev.status,
        toolUseId: ev.toolUseId,
        agent,
      };
      await sendEnvelope(MessageType.TOOL_CALL, JSON.stringify(payload));

      // Phase 8: Todo 提取
      if (ev.status === "done") {
        const todos = extractTodosFromAgentOutput({ tool: ev.tool, params: ev.params });
        if (todos) {
          const todoPayload: TodoUpdatePayload = { taskId, todos };
          await sendEnvelope(MessageType.TODO_UPDATE, JSON.stringify(todoPayload));
          eventBus.emit({ type: "task-completed", taskId: taskId ?? "unknown", summary: { todos } });
        }
      }
      break;
    }

    case "tool_result": {
      const payload: ToolCallPayload = {
        tool: ev.tool,
        params: {},
        status: ev.status,
        result: ev.result,
        toolUseId: ev.toolUseId,
        agent,
      };
      await sendEnvelope(MessageType.TOOL_CALL, JSON.stringify(payload));
      break;
    }

    case "file_diff": {
      const payload: FileDiffPayload = {
        path: ev.path,
        diff: ev.diff,
        action: ev.action,
      };
      await sendEnvelope(MessageType.FILE_DIFF, JSON.stringify(payload));
      break;
    }

    case "hook_event": {
      await sendEnvelope(
        MessageType.HOOK_EVENT,
        JSON.stringify({ hook: ev.hook, event: ev.event, tool: ev.tool, agent }),
      );
      break;
    }

    case "error": {
      await sendEnvelope(MessageType.STREAM_CHUNK, `[ERROR] ${ev.message}`);
      if (ev.fatal) {
        await sendEnvelope(MessageType.STREAM_END, "");
      }
      break;
    }

    case "status": {
      // 默认不把状态事件混入正文，避免手机端看到 [agent] thread.started/turn.completed。
      // 如需排障可临时开启: YUANIO_STREAM_STATUS=1
      if (streamStatusToChunk && statusCount < 10) {
        await sendEnvelope(MessageType.STREAM_CHUNK, `[${agent}] ${ev.message}\n`);
      }
      break;
    }

    case "usage": {
      if (taskId) {
        const prev = taskUsageMap.get(taskId) ?? { inputTokens: 0, outputTokens: 0 };
        prev.inputTokens += ev.inputTokens;
        prev.outputTokens += ev.outputTokens;
        if (ev.cacheCreationTokens) {
          prev.cacheCreationTokens = (prev.cacheCreationTokens ?? 0) + ev.cacheCreationTokens;
        }
        if (ev.cacheReadTokens) {
          prev.cacheReadTokens = (prev.cacheReadTokens ?? 0) + ev.cacheReadTokens;
        }
        taskUsageMap.set(taskId, prev);

        const report: UsageReportPayload = { taskId, usage: prev, cumulative: true };
        await sendEnvelope(MessageType.USAGE_REPORT, JSON.stringify(report));
      }
      break;
    }

    case "raw":
      break;
  }
}

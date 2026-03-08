import {
  ApprovalRespPayloadSchema,
  DiffActionPayloadSchema,
  InteractionActionPayloadSchema,
  MessageType,
  PtyAckPayloadSchema,
  PtyResizePayloadSchema,
  PtySpawnPayloadSchema,
  TaskQueuePayloadSchema,
  safeParsePayload,
} from "@yuanio/shared";
import type { AgentStatus, BinaryEnvelope, Envelope } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../spawn";
import type { QueueItem } from "../task-queue";
import type { PtyController } from "./pty";
import { handleCancel } from "./cancel";
import { handleDiffAction } from "./diff-action";
import { executeInteractionAction } from "./interaction-action-executor";
import { handleTaskQueue } from "./queue";

export interface NonPromptRouterContext {
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number, ptyId?: string) => Promise<void>;
  runningAgents: Map<string, { handle: AgentHandle; agent: AgentType }>;
  consumeQueueItem: (item: QueueItem) => void;
  maxParallel?: number;
  sendStatus: (s: AgentStatus, reason?: string) => Promise<void> | void;
  sendTelegram: (message: string) => void;
  ptyController: PtyController;
  settleApproval: (id: string, approved: boolean, source: "app" | "telegram") => Promise<boolean>;
  pickPendingApprovalId: (specifiedId?: string) => string | null;
  dispatchInteractionPrompt: (
    prompt: string,
    source: "app" | "telegram" | "notification" | "system",
  ) => Promise<void>;
}

export async function handleNonPromptEnvelope(
  envelope: Envelope | BinaryEnvelope,
  payload: string,
  ctx: NonPromptRouterContext,
): Promise<boolean> {
  if (envelope.type === MessageType.TASK_QUEUE) {
    const tq = safeParsePayload(TaskQueuePayloadSchema, payload, "TASK_QUEUE");
    void handleTaskQueue(tq, ctx.sendEnvelope, ctx.runningAgents, ctx.consumeQueueItem, {
      maxParallel: ctx.maxParallel,
    });
    return true;
  }

  if (envelope.type === MessageType.DIFF_ACTION) {
    const da = safeParsePayload(DiffActionPayloadSchema, payload, "DIFF_ACTION");
    void handleDiffAction(da, ctx.sendEnvelope);
    return true;
  }

  if (envelope.type === MessageType.INTERACTION_ACTION) {
    const actionPayload = safeParsePayload(
      InteractionActionPayloadSchema,
      payload,
      "INTERACTION_ACTION",
    );
    const result = await executeInteractionAction(actionPayload, {
      runningAgents: ctx.runningAgents,
      sendStatus: ctx.sendStatus,
      sendEnvelope: ctx.sendEnvelope,
      sendTelegram: ctx.sendTelegram,
      settleApproval: ctx.settleApproval,
      pickPendingApprovalId: ctx.pickPendingApprovalId,
      dispatchPrompt: ctx.dispatchInteractionPrompt,
    });
    if (!result.ok) {
      ctx.sendTelegram(`[interaction] ${result.message}`);
    }
    return true;
  }

  // 这些消息由 daemon 处理，CLI 端忽略
  if (envelope.type === MessageType.SCHEDULE_LIST ||
      envelope.type === MessageType.SCHEDULE_CREATE ||
      envelope.type === MessageType.SCHEDULE_DELETE) {
    return true;
  }

  // 这些消息由 daemon SessionManager 处理，CLI 端忽略
  if (envelope.type === MessageType.SESSION_SPAWN ||
      envelope.type === MessageType.SESSION_STOP ||
      envelope.type === MessageType.SESSION_LIST) {
    return true;
  }

  if (envelope.type === MessageType.CANCEL) {
    await handleCancel(payload, {
      runningAgents: ctx.runningAgents,
      sendStatus: ctx.sendStatus,
      sendEnvelope: (type, plaintext) => ctx.sendEnvelope(type, plaintext),
      sendTelegram: ctx.sendTelegram,
    });
    return true;
  }

  if (envelope.type === MessageType.PTY_SPAWN) {
    const spawnPayload = safeParsePayload(PtySpawnPayloadSchema, payload, "PTY_SPAWN");
    const ptyId = envelope.ptyId || "default";
    ctx.ptyController.handleSpawn(spawnPayload, ptyId);
    return true;
  }

  if (envelope.type === MessageType.PTY_INPUT) {
    const ptyId = envelope.ptyId || "default";
    ctx.ptyController.handleInput(payload, ptyId);
    return true;
  }

  if (envelope.type === MessageType.PTY_RESIZE) {
    const resizePayload = safeParsePayload(PtyResizePayloadSchema, payload, "PTY_RESIZE");
    const ptyId = envelope.ptyId || "default";
    ctx.ptyController.handleResize(resizePayload, ptyId);
    return true;
  }

  if (envelope.type === MessageType.PTY_KILL) {
    const ptyId = envelope.ptyId || "default";
    ctx.ptyController.handleKill(ptyId);
    return true;
  }

  if (envelope.type === MessageType.PTY_ACK) {
    const ackPayload = safeParsePayload(PtyAckPayloadSchema, payload, "PTY_ACK");
    const ptyId = envelope.ptyId || "default";
    ctx.ptyController.handleAck(ackPayload, ptyId);
    return true;
  }

  if (envelope.type === MessageType.APPROVAL_RESP) {
    const resp = safeParsePayload(ApprovalRespPayloadSchema, payload, "APPROVAL_RESP");
    await ctx.settleApproval(resp.id, resp.approved, "app");
    return true;
  }

  return false;
}

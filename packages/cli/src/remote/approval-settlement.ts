import { loadTelegramChatId, editTelegramMessage } from "../telegram";
import type { AgentStatus } from "@yuanio/shared";
import type { PendingApprovalMeta } from "./approval-request-handler";

export interface CreateApprovalSettlementOptions {
  pendingApprovals: Map<string, PendingApprovalMeta>;
  resolveApprovalById: (id: string, approved: boolean) => void;
  emitApprovalResolved: (requestId: string, approved: boolean) => void;
  getCurrentStatus: () => AgentStatus;
  getRunningAgentsSize: () => number;
  emitStatusAndTurnState: (
    nextStatus: AgentStatus,
    reason?: string,
    force?: boolean,
  ) => Promise<void> | void;
}

export function createApprovalSettlement(options: CreateApprovalSettlementOptions) {
  const settleApproval = async (
    id: string,
    approved: boolean,
    source: "app" | "telegram",
  ): Promise<boolean> => {
    const meta = options.pendingApprovals.get(id);
    options.resolveApprovalById(id, approved);
    options.pendingApprovals.delete(id);

    console.log(`[remote] 审批结果(${source}): ${id} → ${approved ? "批准" : "拒绝"}`);
    options.emitApprovalResolved(id, approved);

    if (options.getCurrentStatus() === "waiting_approval") {
      await options.emitStatusAndTurnState(
        options.getRunningAgentsSize() > 0 ? "running" : "idle",
        "approval_resolved",
      );
    }

    const chatId = loadTelegramChatId();
    if (chatId && meta?.telegramMessageId) {
      const statusText = approved ? "已批准" : "已拒绝";
      void editTelegramMessage(
        chatId,
        meta.telegramMessageId,
        `审批${statusText}\nID: ${id}\n工具: ${meta.tool}\n风险: ${meta.riskLevel}`,
      );
    }

    return !!meta;
  };

  const pickPendingApprovalId = (specifiedId?: string): string | null => {
    if (specifiedId) {
      return options.pendingApprovals.has(specifiedId) ? specifiedId : null;
    }
    let latest: { id: string; ts: number } | null = null;
    for (const [id, meta] of options.pendingApprovals.entries()) {
      if (!latest || meta.createdAt > latest.ts) latest = { id, ts: meta.createdAt };
    }
    return latest?.id || null;
  };

  return {
    settleApproval,
    pickPendingApprovalId,
  };
}

import {
  createApprovalRequestHandler,
  type CreateApprovalRequestHandlerOptions,
  type PendingApprovalMeta,
} from "./approval-request-handler";
import {
  createApprovalSettlement,
  type CreateApprovalSettlementOptions,
} from "./approval-settlement";

export interface CreateApprovalRuntimeOptions extends
  Omit<CreateApprovalRequestHandlerOptions, "pendingApprovals">,
  Omit<CreateApprovalSettlementOptions, "pendingApprovals"> {
  pendingApprovals: Map<string, PendingApprovalMeta>;
}

export function createApprovalRuntime(options: CreateApprovalRuntimeOptions) {
  const { settleApproval, pickPendingApprovalId } = createApprovalSettlement({
    pendingApprovals: options.pendingApprovals,
    resolveApprovalById: options.resolveApprovalById,
    emitApprovalResolved: options.emitApprovalResolved,
    getCurrentStatus: options.getCurrentStatus,
    getRunningAgentsSize: options.getRunningAgentsSize,
    emitStatusAndTurnState: options.emitStatusAndTurnState,
  });

  const approvalRequestHandler = createApprovalRequestHandler({
    getExecutionMode: options.getExecutionMode,
    getPermissionMode: options.getPermissionMode,
    getApprovalLevel: options.getApprovalLevel,
    getPermissionRules: options.getPermissionRules,
    getSandboxPolicy: options.getSandboxPolicy,
    getSessionId: options.getSessionId,
    sendEnvelope: options.sendEnvelope,
    runHook: options.runHook,
    emitStatusAndTurnState: options.emitStatusAndTurnState,
    emitApprovalRequested: options.emitApprovalRequested,
    pendingApprovals: options.pendingApprovals,
    sendTelegram: options.sendTelegram,
    sendTelegramMessage: options.sendTelegramMessage,
  });

  return {
    settleApproval,
    pickPendingApprovalId,
    approvalRequestHandler,
  };
}

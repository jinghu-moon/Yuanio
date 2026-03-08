import type {
  AgentStatus,
  InteractionActionType,
  InteractionStatePayload,
} from "./types";

export interface ResolveInteractionActionsInput {
  state: AgentStatus;
  runningTasks: number;
  pendingApprovals: number;
  lastError?: string;
}

const DEFAULT_ACTION_ORDER: InteractionActionType[] = [
  "continue",
  "stop",
  "approve",
  "reject",
  "retry",
  "rollback",
];

export function resolveInteractionActions(
  input: ResolveInteractionActionsInput,
): InteractionActionType[] {
  const selected = new Set<InteractionActionType>();

  if (input.state === "running") {
    selected.add("stop");
    selected.add("continue");
  }

  if (input.state === "waiting_approval" || input.pendingApprovals > 0) {
    selected.add("approve");
    selected.add("reject");
    if (input.runningTasks > 0) selected.add("stop");
  }

  if (input.state === "idle") {
    selected.add("continue");
    selected.add("retry");
  }

  if (input.state === "error") {
    selected.add("retry");
    selected.add("rollback");
    if (input.runningTasks > 0) selected.add("stop");
  }

  if (input.runningTasks <= 0) {
    selected.delete("stop");
  }

  if (!input.lastError) {
    selected.delete("rollback");
  }

  const ordered = DEFAULT_ACTION_ORDER.filter((action) => selected.has(action));
  return ordered;
}

export interface CreateInteractionStateInput {
  state: AgentStatus;
  sessionId: string;
  version: number;
  reason: string;
  updatedAt: number;
  runningTasks: number;
  pendingApprovals: number;
  activeApprovalId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  riskSummary?: string;
  diffHighlights?: string[];
  lastError?: string;
}

export function createInteractionStatePayload(
  input: CreateInteractionStateInput,
): InteractionStatePayload {
  return {
    state: input.state,
    sessionId: input.sessionId,
    version: input.version,
    reason: input.reason,
    updatedAt: input.updatedAt,
    runningTasks: input.runningTasks,
    pendingApprovals: input.pendingApprovals,
    availableActions: resolveInteractionActions({
      state: input.state,
      runningTasks: input.runningTasks,
      pendingApprovals: input.pendingApprovals,
      lastError: input.lastError,
    }),
    activeApprovalId: input.activeApprovalId,
    riskLevel: input.riskLevel,
    riskSummary: input.riskSummary,
    diffHighlights: input.diffHighlights,
    lastError: input.lastError,
  };
}

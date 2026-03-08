import { MessageType, createInteractionStatePayload } from "@yuanio/shared";
import type { AgentStatus, StatusPayload, TurnStatePayload } from "@yuanio/shared";

export interface CreateTurnStateEmitterOptions {
  getCurrentStatus: () => AgentStatus;
  setCurrentStatus: (status: AgentStatus) => void;
  getSessionId: () => string;
  getProjectPath?: () => string;
  getRunningTasks: () => number;
  getPendingApprovals: () => number;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  emitStatusChanged: (status: AgentStatus) => void;
  initialReason?: string;
}

export function createTurnStateEmitter(options: CreateTurnStateEmitterOptions) {
  let turnStateVersion = 0;
  let turnStateReason = options.initialReason?.trim() || "startup";
  let turnStateUpdatedAt = Date.now();

  const getTurnStateVersion = () => turnStateVersion;
  const getTurnStateReason = () => turnStateReason;
  const getTurnStateUpdatedAt = () => turnStateUpdatedAt;

  const emitStatusAndTurnState = async (
    nextStatus: AgentStatus,
    reason?: string,
    force = false,
  ): Promise<void> => {
    const normalizedReason = (reason && reason.trim()) ? reason : "unknown";
    const currentStatus = options.getCurrentStatus();
    const changed = force || currentStatus !== nextStatus || turnStateReason !== normalizedReason;

    options.setCurrentStatus(nextStatus);
    if (!changed) return;

    turnStateVersion += 1;
    turnStateReason = normalizedReason;
    turnStateUpdatedAt = Date.now();
    options.emitStatusChanged(nextStatus);

    const statusPayload: StatusPayload = {
      status: nextStatus,
      projectPath: options.getProjectPath ? options.getProjectPath() : process.cwd(),
      sessionId: options.getSessionId(),
      version: turnStateVersion,
      reason: turnStateReason,
      updatedAt: turnStateUpdatedAt,
      runningTasks: options.getRunningTasks(),
      pendingApprovals: options.getPendingApprovals(),
    };

    const turnPayload: TurnStatePayload = {
      phase: nextStatus,
      sessionId: options.getSessionId(),
      version: turnStateVersion,
      reason: turnStateReason,
      updatedAt: turnStateUpdatedAt,
      runningTasks: options.getRunningTasks(),
      pendingApprovals: options.getPendingApprovals(),
    };
    const interactionPayload = createInteractionStatePayload({
      state: nextStatus,
      sessionId: options.getSessionId(),
      version: turnStateVersion,
      reason: turnStateReason,
      updatedAt: turnStateUpdatedAt,
      runningTasks: options.getRunningTasks(),
      pendingApprovals: options.getPendingApprovals(),
    });

    await options.sendEnvelope(MessageType.STATUS, JSON.stringify(statusPayload));
    await options.sendEnvelope(MessageType.TURN_STATE, JSON.stringify(turnPayload));
    await options.sendEnvelope(MessageType.INTERACTION_STATE, JSON.stringify(interactionPayload));
  };

  return {
    emitStatusAndTurnState,
    getTurnStateVersion,
    getTurnStateReason,
    getTurnStateUpdatedAt,
  };
}

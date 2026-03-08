import type { TelegramApprovalsPageResult, TelegramWebhookHandlers } from "../telegram-webhook";
import { handleTelegramApprovalsCommand } from "./telegram-approvals";
import type { DispatchRpcForTelegram } from "./telegram-rpc-handlers";
import { handleTelegramRewindCommand } from "./telegram-rewind";
import { handleTelegramSkillCommand, handleTelegramSkillsCommand } from "./telegram-skills";
import {
  handleTelegramApproveCommand,
  handleTelegramForwardCommand,
  handleTelegramInteractiveInput,
  handleTelegramRejectCommand,
  handleTelegramResumeCommand,
  handleTelegramResumeListCommand,
  type TelegramInteractionContext,
} from "./telegram-interaction";

interface TelegramBaseHandlersLike {
  onPrompt: (prompt: string) => Promise<void>;
  onContinue: () => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => Promise<string>;
  onLoop: (prompt: string) => Promise<string>;
  onStatus: () => Promise<string>;
  onMode: (mode?: string) => Promise<string>;
  onTasks: () => Promise<string>;
  onHistory: (args: string[]) => Promise<string>;
  onCheckpointList: () => Promise<string>;
  onCheckpointRestore: (checkpointId: string) => Promise<string>;
}

interface TelegramRpcHandlersLike {
  onTask: (args: string[]) => Promise<string>;
  onContextUsage: () => Promise<string>;
  onCompactContext: (instructions?: string) => Promise<string>;
  onMemory: (args: string[]) => Promise<string>;
  onAgents: (args: string[]) => Promise<string>;
  onStyle: (args: string[]) => Promise<string>;
  onPermissions: (args: string[]) => Promise<string>;
  onStatusline: (args: string[]) => Promise<string>;
  onCwd: (path?: string) => Promise<string>;
  onProbe: () => Promise<string>;
}

export interface CreateTelegramWebhookHandlersOptions {
  baseHandlers: TelegramBaseHandlersLike;
  rpcHandlers: TelegramRpcHandlersLike;
  interactionContext: TelegramInteractionContext;
  approvalsListToPageIds: (page: number) => string[];
  buildApprovalsPageResult: (page: number, banner?: string) => TelegramApprovalsPageResult;
  settleApproval: (id: string, approved: boolean, source: "app" | "telegram") => Promise<boolean>;
  dispatchRpcForTelegram: DispatchRpcForTelegram;
}

export function createTelegramWebhookHandlers(
  options: CreateTelegramWebhookHandlersOptions,
): TelegramWebhookHandlers {
  return {
    onPrompt: async (prompt) => options.baseHandlers.onPrompt(prompt),
    onContinue: async () => options.baseHandlers.onContinue(),
    onStop: async () => options.baseHandlers.onStop(),
    onClear: async () => options.baseHandlers.onClear(),
    onLoop: async (prompt) => options.baseHandlers.onLoop(prompt),
    onStatus: async () => options.baseHandlers.onStatus(),
    onMode: async (mode) => options.baseHandlers.onMode(mode),
    onTasks: async () => options.baseHandlers.onTasks(),
    onHistory: async (args) => options.baseHandlers.onHistory(args),
    onTask: async (args) => options.rpcHandlers.onTask(args),
    onApprovals: async (args) => {
      return handleTelegramApprovalsCommand(args, {
        approvalsListToPageIds: options.approvalsListToPageIds,
        buildApprovalsPageResult: options.buildApprovalsPageResult,
        settleApproval: options.settleApproval,
      });
    },
    onCheckpointList: async () => options.baseHandlers.onCheckpointList(),
    onCheckpointRestore: async (checkpointId) => options.baseHandlers.onCheckpointRestore(checkpointId),
    onContextUsage: async () => options.rpcHandlers.onContextUsage(),
    onCompactContext: async (instructions) => options.rpcHandlers.onCompactContext(instructions),
    onRewind: async (target, dryRun) => handleTelegramRewindCommand(target, dryRun, options.dispatchRpcForTelegram),
    onMemory: async (args) => options.rpcHandlers.onMemory(args),
    onAgents: async (args) => options.rpcHandlers.onAgents(args),
    onStyle: async (args) => options.rpcHandlers.onStyle(args),
    onPermissions: async (args) => options.rpcHandlers.onPermissions(args),
    onStatusline: async (args) => options.rpcHandlers.onStatusline(args),
    onSkill: async (name, args) => {
      return handleTelegramSkillCommand(name, args, options.dispatchRpcForTelegram);
    },
    onSkills: async (args) => {
      return handleTelegramSkillsCommand(args, options.dispatchRpcForTelegram);
    },
    onCwd: async (path) => options.rpcHandlers.onCwd(path),
    onProbe: async () => options.rpcHandlers.onProbe(),
    onApprove: async (specifiedId) => handleTelegramApproveCommand(specifiedId, options.interactionContext),
    onReject: async (specifiedId) => handleTelegramRejectCommand(specifiedId, options.interactionContext),
    onResumeList: async () => handleTelegramResumeListCommand(options.interactionContext),
    onResume: async (resumeSessionId) => handleTelegramResumeCommand(resumeSessionId, options.interactionContext),
    onForwardCommand: async (rawText, command) => handleTelegramForwardCommand(rawText, command, options.interactionContext),
    onInteractiveInput: async (input, _behavior) => handleTelegramInteractiveInput(input, options.interactionContext),
    onInteractionAction: async (payload) => options.interactionContext.executeInteractionAction({
      ...payload,
      source: "telegram",
    }),
  };
}

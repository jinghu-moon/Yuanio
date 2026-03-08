import { MessageType } from "@yuanio/shared";
import type { Envelope, IngressPromptSource } from "@yuanio/shared";
import { buildSkillPromptByName } from "./skill-engine";
import { buildAgentDelegationPrompt } from "./agent-config";

interface CompactSummaryItem {
  id: string;
  at: number;
  instructions?: string;
}

interface DispatchPromptInput {
  envelope: Envelope;
  payload: string;
  skipAck?: boolean;
  source?: IngressPromptSource;
}

export interface CreatePromptActionsOptions<TContext> {
  deviceId: string;
  getSessionId: () => string;
  getCwd: () => string;
  dispatchPrompt: (params: DispatchPromptInput) => Promise<void>;
  getContextUsage: () => TContext;
  compactSummaries: CompactSummaryItem[];
  compactSummaryLimit?: number;
}

export interface InvokeSkillResult {
  invoked: boolean;
  type?: "skill" | "agent";
  taskPromptId?: string;
  reason?: string;
  skill?: {
    name: string;
    description: string;
    source: string;
    scope: string;
  };
  agent?: {
    name: string;
    description: string;
  };
}

export function createPromptActions<TContext>(options: CreatePromptActionsOptions<TContext>) {
  const summaryLimit = Number.isFinite(options.compactSummaryLimit)
    ? Math.max(1, Math.floor(options.compactSummaryLimit as number))
    : 60;

  const buildSyntheticPromptEnvelope = (sourceId: string): Envelope => ({
    id: `${sourceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    source: sourceId,
    target: options.deviceId,
    sessionId: options.getSessionId(),
    type: MessageType.PROMPT,
    ts: Date.now(),
    payload: "",
  });

  const runCompactContext = async (instructions?: string) => {
    const compactPrompt = [
      "请执行会话压缩（compact）：",
      "1. 输出当前任务上下文的精简摘要（目标<= 600 字）。",
      "2. 明确保留：目标、约束、已完成、待办、风险。",
      "3. 丢弃冗余日志与重复信息。",
      instructions?.trim() ? `附加要求: ${instructions.trim()}` : undefined,
    ].filter(Boolean).join("\n");

    const envelope = buildSyntheticPromptEnvelope("compact");
    options.compactSummaries.unshift({
      id: envelope.id,
      at: Date.now(),
      instructions: instructions?.trim() || undefined,
    });
    if (options.compactSummaries.length > summaryLimit) {
      options.compactSummaries.splice(summaryLimit);
    }

    await options.dispatchPrompt({
      envelope,
      payload: compactPrompt,
      skipAck: true,
      source: "queue",
    });

    return {
      started: true,
      promptId: envelope.id,
      prompt: compactPrompt,
      context: options.getContextUsage(),
    };
  };

  const invokeSkillPrompt = async (name: string, args = ""): Promise<InvokeSkillResult> => {
    const cwd = options.getCwd();
    const skillHit = buildSkillPromptByName(name, args, cwd);
    if (skillHit) {
      const envelope = buildSyntheticPromptEnvelope("skill");
      await options.dispatchPrompt({
        envelope,
        payload: skillHit.prompt,
        skipAck: true,
        source: "queue",
      });
      return {
        invoked: true,
        type: "skill",
        taskPromptId: envelope.id,
        skill: {
          name: skillHit.skill.name,
          description: skillHit.skill.description,
          source: skillHit.skill.source,
          scope: skillHit.skill.scope,
        },
      };
    }

    const delegated = buildAgentDelegationPrompt(name, args, cwd);
    if (delegated) {
      const envelope = buildSyntheticPromptEnvelope("agent_delegate");
      await options.dispatchPrompt({
        envelope,
        payload: delegated.prompt,
        skipAck: true,
        source: "queue",
      });
      return {
        invoked: true,
        type: "agent",
        taskPromptId: envelope.id,
        agent: {
          name: delegated.agent.name,
          description: delegated.agent.description,
        },
      };
    }

    return {
      invoked: false,
      reason: `skill/agent not found: ${name}`,
    };
  };

  return {
    buildSyntheticPromptEnvelope,
    runCompactContext,
    invokeSkillPrompt,
  };
}

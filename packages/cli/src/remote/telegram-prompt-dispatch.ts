import { MessageType } from "@yuanio/shared";
import type { Envelope, IngressPromptSource } from "@yuanio/shared";
import type { AgentType } from "../spawn";

interface DispatchPromptParams {
  envelope: Envelope;
  payload: string;
  agentOverride?: AgentType;
  resumeSessionId?: string;
  skipAck?: boolean;
  source?: IngressPromptSource;
}

export interface TelegramPromptDispatchContext {
  deviceId: string;
  getSessionId: () => string;
  dispatchPrompt: (params: DispatchPromptParams) => Promise<void>;
}

function createTelegramEnvelope(deviceId: string, sessionId: string): Envelope {
  return {
    id: `tg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    source: "telegram",
    target: deviceId,
    sessionId,
    type: MessageType.PROMPT,
    ts: Date.now(),
    payload: "",
  };
}

export function createTelegramPromptDispatcher(ctx: TelegramPromptDispatchContext) {
  const sendPrompt = async (
    prompt: string,
    options?: {
      agentOverride?: AgentType;
      resumeSessionId?: string;
    },
  ): Promise<void> => {
    const env = createTelegramEnvelope(ctx.deviceId, ctx.getSessionId());
    await ctx.dispatchPrompt({
      envelope: env,
      payload: prompt,
      agentOverride: options?.agentOverride,
      resumeSessionId: options?.resumeSessionId,
      skipAck: true,
      source: "telegram",
    });
  };

  return {
    sendPrompt,
    sendContinue: () => sendPrompt("continue"),
    sendResume: (resumeSessionId: string) => sendPrompt("continue", {
      agentOverride: "claude",
      resumeSessionId,
    }),
    sendForwardPrompt: (rawText: string) => sendPrompt(rawText),
    sendInteractiveInput: (input: string) => sendPrompt(input),
  };
}

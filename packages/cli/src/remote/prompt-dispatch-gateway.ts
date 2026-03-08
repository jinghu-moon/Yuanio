import { MessageType } from "@yuanio/shared";
import type { DispatchPromptParams } from "./prompt-dispatch-runtime";

interface PromptPreprocessResult {
  finalPrompt: string;
  notes: string[];
  blockedReason?: string;
}

export interface CreatePromptDispatchGatewayOptions {
  preprocessPromptForExecution: (rawPrompt: string) => Promise<PromptPreprocessResult>;
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>;
  sendTelegram: (message: string) => void | Promise<void>;
  sendTelegramMessage: (options: { text: string; disableNotification?: boolean }) => Promise<number | null>;
  executePrompt: (params: DispatchPromptParams) => Promise<void>;
}

export function createPromptDispatchGateway(options: CreatePromptDispatchGatewayOptions) {
  return async (params: DispatchPromptParams) => {
    const { finalPrompt, notes, blockedReason } = await options.preprocessPromptForExecution(params.payload);

    if (blockedReason) {
      await options.sendEnvelope(MessageType.HOOK_EVENT, JSON.stringify({
        hook: "UserPromptSubmit",
        event: "blocked",
        tool: "prompt",
        reason: blockedReason,
      }));
      if (params.source === "telegram") {
        void options.sendTelegramMessage({
          text: `Prompt 被 Hook 拦截：${blockedReason}`,
          disableNotification: true,
        });
      } else {
        void options.sendTelegram(`Prompt 被 Hook 拦截：${blockedReason}`);
      }
      return;
    }

    if (notes.length > 0 && params.source === "telegram") {
      void options.sendTelegramMessage({
        text: `Prompt 预处理: ${notes.join(" | ")}`,
        disableNotification: true,
      });
    }

    await options.executePrompt({
      ...params,
      payload: finalPrompt,
    });
  };
}

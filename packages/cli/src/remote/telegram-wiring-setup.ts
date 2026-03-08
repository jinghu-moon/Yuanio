import {
  createTelegramPanels,
  type CreateTelegramPanelsOptions,
} from "./telegram-panels";
import { createTelegramWiring } from "./telegram-wiring";
import {
  createTelegramWiringOptions,
  type CreateTelegramWiringBuilderOptions,
} from "./telegram-wiring-options";

type TelegramWiringInput = Omit<
  CreateTelegramWiringBuilderOptions,
  | "dispatchRpcForTelegram"
  | "renderTaskOutputText"
  | "clampTextForTelegram"
  | "listTaskHistoryText"
  | "approvalsListToPageIds"
  | "buildApprovalsPageResult"
>;

export interface CreateTelegramWiringSetupOptions {
  panels: CreateTelegramPanelsOptions;
  wiring: TelegramWiringInput;
}

export function createTelegramWiringSetup(options: CreateTelegramWiringSetupOptions) {
  const panels = createTelegramPanels(options.panels);
  const dispatchRpcForTelegram = async (method: string, params?: Record<string, unknown>) => {
    const result = await options.panels.dispatchRpcForTelegram(method, params);
    return {
      result: result.result,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  };

  return createTelegramWiring(
    createTelegramWiringOptions({
      ...options.wiring,
      dispatchRpcForTelegram,
      renderTaskOutputText: panels.renderTaskOutputText,
      clampTextForTelegram: panels.clampTextForTelegram,
      listTaskHistoryText: panels.listTaskHistoryText,
      approvalsListToPageIds: panels.approvalsListToPageIds,
      buildApprovalsPageResult: panels.buildApprovalsPageResult,
    }),
  );
}

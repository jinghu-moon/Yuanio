import {
  createStatuslineRuntime,
  type CreateStatuslineRuntimeOptions,
} from "./statusline-runtime";
import {
  createModeController,
  type CreateModeControllerOptions,
} from "./mode-controller";
import {
  createPromptPreprocessorRuntime,
  type CreatePromptPreprocessorRuntimeOptions,
} from "./prompt-preprocessor-runtime";
import { createTelegramCommandPolicy } from "./telegram-command-policy";

export interface CreateCoreRuntimeSetupOptions {
  env?: NodeJS.ProcessEnv;
  statusline: CreateStatuslineRuntimeOptions;
  mode: CreateModeControllerOptions;
  preprocessor: CreatePromptPreprocessorRuntimeOptions;
}

export function createCoreRuntimeSetup(options: CreateCoreRuntimeSetupOptions) {
  const { getContextUsage, renderStatusline } = createStatuslineRuntime(options.statusline);
  const {
    loopMaxIterations,
    validateForwardCommand,
    buildLoopPrompt,
  } = createTelegramCommandPolicy(options.env || process.env);
  const { setExecutionMode, setPermissionModeByRpc } = createModeController(options.mode);
  const { preprocessPromptForExecution } = createPromptPreprocessorRuntime(options.preprocessor);

  return {
    getContextUsage,
    renderStatusline,
    loopMaxIterations,
    validateForwardCommand,
    buildLoopPrompt,
    setExecutionMode,
    setPermissionModeByRpc,
    preprocessPromptForExecution,
  };
}

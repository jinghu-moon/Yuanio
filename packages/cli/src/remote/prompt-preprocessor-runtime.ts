import { preprocessPromptForExecution as preprocessPrompt } from "./prompt-preprocess";

type PromptPreprocessOptions = Parameters<typeof preprocessPrompt>[1];

export interface CreatePromptPreprocessorRuntimeOptions {
  getExecutionMode: () => "act" | "plan";
  getCwd: () => string;
  getSessionId: () => string;
  contextRefsEnabled: boolean;
  runUserPromptSubmitHook: PromptPreprocessOptions["runUserPromptSubmitHook"];
  applyPromptContextRefs: PromptPreprocessOptions["applyPromptContextRefs"];
  terminalSnapshot: PromptPreprocessOptions["terminalSnapshot"];
  buildAutoMemoryContext: PromptPreprocessOptions["buildAutoMemoryContext"];
  getOutputStyle: PromptPreprocessOptions["getOutputStyle"];
  applyOutputStyleToPrompt: PromptPreprocessOptions["applyOutputStyleToPrompt"];
}

function buildPlanPrompt(userPrompt: string): string {
  return [
    "你当前处于 PLAN 模式。",
    "严格要求：只输出可执行计划、风险和验证步骤；禁止修改文件、禁止执行会写磁盘/改仓库的命令。",
    "如果用户请求直接执行，请先返回计划并等待切换到 ACT 模式。",
    "",
    "用户请求：",
    userPrompt,
  ].join("\n");
}

export function createPromptPreprocessorRuntime(options: CreatePromptPreprocessorRuntimeOptions) {
  const preprocessPromptForExecution = async (rawPrompt: string) => preprocessPrompt(
    rawPrompt,
    {
      executionMode: options.getExecutionMode(),
      cwd: options.getCwd(),
      sessionId: options.getSessionId(),
      contextRefsEnabled: options.contextRefsEnabled,
      runUserPromptSubmitHook: options.runUserPromptSubmitHook,
      applyPromptContextRefs: options.applyPromptContextRefs,
      terminalSnapshot: options.terminalSnapshot,
      buildAutoMemoryContext: options.buildAutoMemoryContext,
      getOutputStyle: options.getOutputStyle,
      applyOutputStyleToPrompt: options.applyOutputStyleToPrompt,
      buildPlanPrompt,
    },
  );

  return {
    preprocessPromptForExecution,
  };
}

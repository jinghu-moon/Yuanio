import { applyTriPhasePrompt } from "./tri-phase";

export type PromptExecutionMode = "act" | "plan";

interface UserPromptSubmitHookResult {
  blocked: boolean;
  reason?: string;
  injectedContext: string[];
}

interface PromptContextResult {
  prompt: string;
  resolved: string[];
  unresolved: string[];
}

interface OutputStyleLike {
  id: string;
}

export interface PromptPreprocessContext {
  executionMode: PromptExecutionMode;
  cwd: string;
  sessionId: string;
  contextRefsEnabled: boolean;
  runUserPromptSubmitHook: (
    payload: Record<string, unknown>,
  ) => Promise<UserPromptSubmitHookResult | null>;
  applyPromptContextRefs: (
    prompt: string,
    options: { cwd: string; terminalSnapshot: () => string },
  ) => Promise<PromptContextResult>;
  terminalSnapshot: () => string;
  buildAutoMemoryContext: (cwd: string, maxLines: number) => string;
  getOutputStyle: (cwd: string) => OutputStyleLike;
  applyOutputStyleToPrompt: (prompt: string, style: OutputStyleLike) => string;
  buildPlanPrompt: (userPrompt: string) => string;
}

export interface PromptPreprocessResult {
  finalPrompt: string;
  notes: string[];
  blockedReason?: string;
}

export async function preprocessPromptForExecution(
  rawPrompt: string,
  ctx: PromptPreprocessContext,
): Promise<PromptPreprocessResult> {
  let prompt = rawPrompt;
  const notes: string[] = [];

  const submitHook = await ctx.runUserPromptSubmitHook({
    event: "user_prompt_submit",
    prompt: rawPrompt,
    mode: ctx.executionMode,
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
  });
  if (submitHook?.blocked) {
    return {
      finalPrompt: rawPrompt,
      notes: [`hook=blocked:${submitHook.reason || "unknown"}`],
      blockedReason: submitHook.reason || "blocked by UserPromptSubmit hook",
    };
  }

  if (submitHook && submitHook.injectedContext.length > 0) {
    prompt = [
      ...submitHook.injectedContext.slice(0, 3).map((line) => `[Hook Context]\n${line}`),
      "",
      prompt,
    ].join("\n");
    notes.push(`hook_context=${submitHook.injectedContext.length}`);
  }

  if (ctx.contextRefsEnabled) {
    const contextResult = await ctx.applyPromptContextRefs(prompt, {
      cwd: ctx.cwd,
      terminalSnapshot: ctx.terminalSnapshot,
    });
    prompt = contextResult.prompt;
    if (contextResult.resolved.length > 0) {
      notes.push(`refs=${contextResult.resolved.map((r) => `@${r}`).join(",")}`);
    }
    if (contextResult.unresolved.length > 0) {
      notes.push(`unresolved=${contextResult.unresolved.map((r) => `@${r}`).join(",")}`);
    }
  }

  const memoryContext = ctx.buildAutoMemoryContext(ctx.cwd, 200);
  if (memoryContext) {
    prompt = `${memoryContext}\n\n${prompt}`;
    notes.push("memory=on");
  } else {
    notes.push("memory=off");
  }

  const outputStyle = ctx.getOutputStyle(ctx.cwd);
  if (outputStyle.id !== "default") {
    prompt = ctx.applyOutputStyleToPrompt(prompt, outputStyle);
  }
  notes.push(`style=${outputStyle.id}`);

  if (ctx.executionMode === "plan") {
    prompt = ctx.buildPlanPrompt(prompt);
    notes.push("mode=PLAN");
  } else {
    const triPhase = applyTriPhasePrompt(prompt);
    if (triPhase.applied) {
      prompt = triPhase.prompt;
      notes.push("tri_phase=on");
    } else {
      notes.push(`tri_phase=off(${triPhase.reason})`);
    }
    notes.push("mode=ACT");
  }

  return { finalPrompt: prompt, notes };
}

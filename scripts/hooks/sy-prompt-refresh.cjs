#!/usr/bin/env node
"use strict";
/**
 * sy-prompt-refresh.cjs
 * Event:   UserPromptSubmit
 * Purpose: Re-anchor constraint routing on prompts that are likely to trigger
 *          implementation work in long sessions where the SessionStart bootstrap
 *          has drifted out of active context.
 *
 * Design philosophy (ECC + superpowers):
 *   - SessionStart handles the heavy bootstrap (git state, workflow state, full routing).
 *   - UserPromptSubmit handles ONLY the constraint anchor: a 2-line reminder that
 *     fires ONLY when (a) the session is in an active workflow phase AND (b) the
 *     prompt matches implementation-relevant keywords.
 *   - This is not a gate — always exits 0. Only injects context.
 *   - Keeps injection under 30 tokens. Budget preservation is the primary constraint.
 *
 * sy-constraints alignment:
 *   Reinforces the "Do not implement first and backfill constraints later" principle
 *   from sy-constraints/execution at the prompt-intake boundary.
 */

const { asObject, loadPolicy, loadWorkflowState,
        parseJsonSafe, readStdin } = require("./sy-hook-lib.cjs");

(async () => {
  try {
    const raw     = await readStdin();
    const payload = asObject(parseJsonSafe(raw, {}));
    const cwd     = String(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const { policy } = loadPolicy(cwd);
    const pr = asObject(policy.promptRefresh);

    if (process.env[String(pr.bypassEnv || "SY_BYPASS_PROMPT_REFRESH")] === "1") {
      process.stdout.write("{}");
      return;
    }

    // Only fire during active workflow phases
    const state = loadWorkflowState(cwd, policy);
    const activePhases = Array.isArray(pr.activePhases) ? pr.activePhases : ["plan","execute","review"];
    if (!state.exists || !activePhases.includes(state.phase)) {
      process.stdout.write("{}");
      return;
    }

    // Only fire when prompt contains implementation-relevant keywords
    const prompt   = String(payload.prompt || payload.message || "").toLowerCase();
    const keywords = Array.isArray(pr.triggerKeywords) ? pr.triggerKeywords : [];
    const matches  = keywords.some((kw) => prompt.includes(String(kw).toLowerCase()));
    if (!matches) {
      process.stdout.write("{}");
      return;
    }

    // Minimal anchor — enough to re-route without burning budget
    const anchor = [
      `[sy-constraints] Active workflow phase: ${state.phase}.`,
      "Load relevant child constraint skill BEFORE writing any code.",
      "Hooks enforce dangerous-command and secrets guards. Do not pre-empt them.",
    ].join(" ");

    process.stdout.write(JSON.stringify({ context: anchor }));
  } catch {
    process.stdout.write("{}");
  }
})();

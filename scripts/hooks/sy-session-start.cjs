#!/usr/bin/env node
"use strict";
/**
 * sy-session-start.cjs
 * Event:   SessionStart
 * Purpose: Inject SY-BOOTSTRAP context + surface active workflow state
 *          + git context into the first-turn context window.
 *
 * Output:  { additional_context: "..." }   (Claude Code SessionStart API)
 *
 * Design:  Keeps injection minimal (<80 tokens of boilerplate) so it does
 *          not burn context budget on quiet sessions. Surfaces state only
 *          when it exists and is actionable.
 */

const { execSync }            = require("node:child_process");
const fs                       = require("node:fs");
const path                     = require("node:path");
const { asObject, loadPolicy,
        loadWorkflowState,
        parseJsonSafe, readStdin } = require("./sy-hook-lib.cjs");

function escapeJson(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\r/g, "\\r").replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function gitContext(cwd) {
  try {
    const branch = execSync("git branch --show-current", { cwd, stdio: ["pipe","pipe","ignore"] })
                     .toString().trim() || "unknown";
    const dirty  = execSync("git status --porcelain", { cwd, stdio: ["pipe","pipe","ignore"] })
                     .toString().trim().split("\n").filter(Boolean).length;
    return `GIT: branch=${branch}  dirty_files=${dirty}`;
  } catch { return null; }
}

function workflowContext(state) {
  if (!state.exists || state.isDone || state.isStale) return null;
  if (!state.phase && !state.nextAction) return null;
  const lines = [
    "ACTIVE WORKFLOW:",
    `  phase=${state.phase || "(unknown)"}  next_action=${state.nextAction || "(unknown)"}`,
    "  Run `工作流 继续` to resume or `工作流 状态` to inspect.",
  ];
  return lines.join("\\n");
}

function buildBootstrap(policy, extras) {
  const ss = asObject(policy.sessionStart);
  const wf  = String(ss.workflowSkill      || "sy-workflow");
  const con = String(ss.constraintsSkill   || "sy-constraints");
  const max = Number.isFinite(Number(ss.maxChildSkillsPerTurn))
                ? Number(ss.maxChildSkillsPerTurn) : 2;

  const lines = [
    "<SY-BOOTSTRAP>",
    `If there is even a 1% chance a sy-* skill applies, invoke the relevant skill first.`,
    `Route via \`${wf}\`. Load baseline constraints via \`${con}\`.`,
    `Load child constraint skills minimally — baseline + at most ${max} task-specific children per turn`,
    `unless an incident or security escalation is active.`,
    `Hooks enforce hard guards (dangerous commands, secrets, completion claims).`,
    `Do NOT implement first and backfill constraints later. Constraints are pre-conditions.`,
    "</SY-BOOTSTRAP>",
    ...extras.filter(Boolean),
  ];

  return lines.join("\n");
}

(async () => {
  try {
    const raw     = await readStdin();
    const payload = asObject(parseJsonSafe(raw, {}));
    const cwd     = String(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const { policy } = loadPolicy(cwd);
    const ss = asObject(policy.sessionStart);

    if (ss.enabled === false) { process.stdout.write("{}"); return; }

    const extras = [
      gitContext(cwd),
      workflowContext(loadWorkflowState(cwd, policy)),
      fs.existsSync(path.join(cwd, ".ai/index.json"))
        ? null
        : "INDEX: .ai/index.json not found — run `/init` before any development task.",
    ];

    const bootstrap = buildBootstrap(policy, extras);
    const escaped   = escapeJson(bootstrap);

    process.stdout.write(JSON.stringify({
      additional_context: bootstrap,
      hookSpecificOutput: {
        hookEventName:     "SessionStart",
        additionalContext: bootstrap,
      },
    }));
  } catch {
    process.stdout.write("{}");
  }
})();

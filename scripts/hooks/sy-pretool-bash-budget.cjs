#!/usr/bin/env node
"use strict";
/**
 * sy-pretool-bash-budget.cjs
 * Event:   PreToolUse  (matcher: Bash)
 * Purpose: Enforce executing-plans loop budget for auto/batch/parallel modes.
 *          Blocks execution commands when any budget dimension is exhausted,
 *          forcing a structured checkpoint instead of silent overrun.
 *
 * Skill alignment: executing-plans (SKILL.md — Execution Modes + Loop Budget)
 *   The skill defines the budget contract but cannot self-enforce it — Claude
 *   could continue past budget under cognitive load. This hook enforces it
 *   mechanically at every Bash invocation during non-normal execution modes.
 *
 * Checked budget dimensions (session.yaml loop_budget_* fields; legacy session.md also supported):
 *   max_nodes      — count of verified nodes in audit.jsonl (TDD_GREEN + VERIFY entries)
 *   max_minutes    — elapsed time since loop_budget_started_at
 *   max_consecutive_failures — consecutive FAIL entries in audit.jsonl
 *
 * Exit semantics:
 *   exit 0  — budget OK, allow command
 *   exit 2  — budget hit, BLOCK with structured checkpoint message
 *
 * Bypass: SY_BYPASS_LOOP_BUDGET=1 (or SY_BYPASS_PRETOOL_BASH=1 for full bash bypass)
 *
 * Only activates when:
 *   - session.yaml current_phase = execute
 *   - session.yaml mode IN [auto, batch, parallel]
 *   - loop_budget fields are present
 *   - command looks like a test or verify execution (not a read-only command)
 *
 * sy-constraints alignment:
 *   sy-constraints/execution — autonomous loop safety (budget-as-exit-condition)
 *   sy-constraints/phase     — checkpoint after every verified node
 */

const fs   = require("node:fs");
const path = require("node:path");

const { asObject, allow, block, loadPolicy, loadWorkflowState,
        parseJsonSafe, readStdin, resolveCwd } = require("./sy-hook-lib.cjs");

// Commands that indicate autonomous execution (not read-only exploration)
const EXECUTION_PATTERNS = [
  /\bcargo\s+(test|build|check|clippy|run)\b/i,
  /\bnpm\s+(test|run|build)\b/i,
  /\bpnpm\s+(test|run|build)\b/i,
  /\bbun\s+(test|run|build)\b/i,
  /\bdeno\s+(test|run|build)\b/i,
  /\bpytest\b/i,
  /\bgo\s+(test|build|run)\b/i,
  /\bnpx\s+(jest|vitest|mocha|tsc)\b/i,
  /\bvitest\s+run\b/i,
  /\beslint\b/i,
  /\bruff\s+check\b/i,
  /\bmypy\b/i,
];

function looksLikeExecution(command) {
  return EXECUTION_PATTERNS.some(p => p.test(command));
}

/**
 * Count verified nodes from audit.jsonl.
 * A node is "verified" when a VERIFY_PASS entry exists for it.
 */
function countVerifiedNodes(auditPath) {
  try {
    if (!fs.existsSync(auditPath)) return 0;
    const lines = fs.readFileSync(auditPath, "utf8").split("\n").filter(Boolean);
    const nodes = new Set();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.event === "VERIFY_PASS" && entry.node) {
          nodes.add(String(entry.node));
        }
      } catch { /* skip malformed lines */ }
    }
    return nodes.size;
  } catch { return 0; }
}

/**
 * Count consecutive failures at the tail of audit.jsonl.
 */
function countConsecutiveFailures(auditPath) {
  try {
    if (!fs.existsSync(auditPath)) return 0;
    const lines = fs.readFileSync(auditPath, "utf8")
      .split("\n").filter(Boolean).reverse(); // newest first
    let count = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.event === "VERIFY_FAIL") { count++; continue; }
        if (entry.event === "VERIFY_PASS") break; // streak broken
      } catch { /* skip */ }
    }
    return count;
  } catch { return 0; }
}

(async () => {
  try {
    const raw     = await readStdin();
    const payload = asObject(parseJsonSafe(raw, {}));
    const cwd     = resolveCwd(payload);

    // ── Bypass checks ─────────────────────────────────────────────────────────
    const { policy } = loadPolicy(cwd);
    const cfg = asObject(policy.pretoolBash);
    // Primary: skill-specific budget bypass. Secondary: full bash bypass (from policy or default).
    const budgetBypassEnv = "SY_BYPASS_LOOP_BUDGET";
    const bashBypassEnv   = String(cfg.bypassEnv || "SY_BYPASS_PRETOOL_BASH");
    if (process.env[budgetBypassEnv] === "1" || process.env[bashBypassEnv] === "1") {
      return allow();
    }

    // ── Extract command ───────────────────────────────────────────────────────
    const input   = asObject(payload.tool_input ?? payload.input ?? {});
    const command = String(input.command || input.cmd || "").trim();
    if (!command) return allow();

    // Only gate execution-type commands (not cat, grep, git log, etc.)
    if (!looksLikeExecution(command)) return allow();

    // ── Load workflow state ───────────────────────────────────────────────────
    const state = loadWorkflowState(cwd, policy);
    if (!state.exists || state.phase !== "execute") return allow();

    const fields = asObject(state.fields);
    const mode   = String(fields.mode || "").toLowerCase();

    // Budget only applies to non-normal modes
    if (!["auto", "batch", "parallel"].includes(mode)) return allow();

    // ── Read budget fields ────────────────────────────────────────────────────
    const maxNodes      = Number(fields.loop_budget_max_nodes      ?? 5);
    const maxMinutes    = Number(fields.loop_budget_max_minutes     ?? 30);
    const maxFailures   = Number(fields.loop_budget_max_consecutive_failures ?? 2);
    const startedAtRaw  = String(fields.loop_budget_started_at || "");
    const startedAtMs   = Date.parse(startedAtRaw);

    // If no budget fields set, skip enforcement (budget not initialized yet)
    if (!startedAtRaw) return allow();

    const auditPath      = path.join(cwd, ".ai/workflow/audit.jsonl");
    const verifiedNodes  = countVerifiedNodes(auditPath);
    const consecFailures = countConsecutiveFailures(auditPath);
    const elapsedMs      = Number.isFinite(startedAtMs)
      ? Date.now() - startedAtMs
      : 0;
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);

    // ── Budget checks (fail fast on first hit) ────────────────────────────────
    const hits = [];

    if (verifiedNodes >= maxNodes) {
      hits.push(`max_nodes: ${verifiedNodes}/${maxNodes} nodes verified`);
    }
    if (Number.isFinite(startedAtMs) && elapsedMinutes >= maxMinutes) {
      hits.push(`max_minutes: ${elapsedMinutes}/${maxMinutes} minutes elapsed`);
    }
    if (consecFailures >= maxFailures) {
      hits.push(`max_consecutive_failures: ${consecFailures} consecutive FAIL(s)`);
    }

    if (hits.length === 0) return allow();

    // ── Budget hit — block with structured checkpoint message ─────────────────
    return block(
      "sy-pretool-bash-budget",
      `Loop budget exhausted (mode=${mode})`,
      [
        "",
        "Budget hit:",
        ...hits.map(h => `  ⛔ ${h}`),
        "",
        "Required actions:",
        "  1. Emit a budget checkpoint (summarize completed nodes + current state)",
        "  2. WRITE session.yaml: next_action = \"/execute node <next>\" OR \"all done\"",
        "  3. Await user CONTINUE before resuming",
        "",
        "To override: SY_BYPASS_LOOP_BUDGET=1 (session-scoped)",
        "To adjust:   update loop_budget_* fields in session.yaml before CONTINUE",
        "See: executing-plans/SKILL.md — Loop Budget",
      ],
    );

  } catch {
    // Never block on hook error
    return allow();
  }
})();

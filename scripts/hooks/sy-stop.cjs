#!/usr/bin/env node
"use strict";
/**
 * sy-stop.cjs
 * Event:   Stop  (fires when Claude finishes a response)
 * Purpose: Phase-aware checkpoint gate.
 *          Blocks premature stop if session state indicates incomplete work.
 *
 * Why Stop instead of TaskCompleted for the completion gate?
 *   TaskCompleted payload.prompt is unreliable — in many invocations the field
 *   is absent, causing the entire completion gate to silently pass through.
 *   Stop fires on every response end and gives us deterministic access to
 *   file-system state (session.yaml, ai.report.json, audit.jsonl).
 *   We read state from disk, not from an unreliable payload field.
 *
 * Design (ECC stop.py + superpowers discipline gate):
 *   - File lock prevents recursive Stop loops (30s staleness window).
 *   - Phase-passthrough: quiet phases (design, explore, done) exit 0 immediately.
 *   - Phase-specific gates for plan / execute / review.
 *   - ai.report.json freshness check for verify/review phases.
 *   - Outputs a structured CHECKPOINT INCOMPLETE message so Claude can recover.
 *
 * Blocks (exit 2) ONLY when:
 *   - execute phase: audit.jsonl missing (PostToolUse hook never ran) OR
 *                    last_completed_node has no verification evidence AND
 *                    the node is NOT in progress (partial work is OK to stop)
 *   - review phase:  ai.report.json missing or stale (> maxReportAgeHours)
 *   - session:       workflow session parse error in an active phase
 *
 * sy-constraints alignment:
 *   sy-constraints/verify  — "no completion claim without fresh verification"
 *   sy-constraints/phase   — checkpoint after every completed node
 *   sy-constraints/execution — phase gate enforcement
 *
 * Emergency bypass: SY_BYPASS_STOP_GUARD=1
 */

const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");

const { asObject, allow, block,
        countLedgerNodes, loadPolicy, loadWorkflowState,
        parseJsonSafe, readStdin, resolveCwd } = require("./sy-hook-lib.cjs");

const LOCK_PATH = path.join(os.tmpdir(), ".sy_stop_hook_active");

function acquireLock(stalenessMs) {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
      if (age < stalenessMs) return false; // already running
      fs.unlinkSync(LOCK_PATH);
    }
    fs.writeFileSync(LOCK_PATH, String(Date.now()), "utf8");
    return true;
  } catch { return true; } // if lock fails, proceed
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* noop */ }
}

function loadReport(reportPath) {
  try {
    if (!fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch { return null; }
}

function reportIsStale(report, maxAgeHours) {
  const ts = Date.parse(String(
    asObject(report).updated_at || asObject(report).generated_at || ""
  ));
  if (!Number.isFinite(ts)) return false; // no timestamp → can't judge staleness
  return Date.now() - ts > maxAgeHours * 3_600_000;
}

function auditExists(cwd) {
  return fs.existsSync(path.join(cwd, ".ai/workflow/audit.jsonl"));
}

function verificationStates(report) {
  const v = asObject(asObject(report).verification);
  return {
    compile: String(v.compile || "skip").toLowerCase(),
    test:    String(v.test    || "skip").toLowerCase(),
    lint:    String(v.lint    || "skip").toLowerCase(),
    build:   String(v.build   || "skip").toLowerCase(),
  };
}

(async () => {
  try {
    const raw     = await readStdin();
    const payload = asObject(parseJsonSafe(raw, {}));
    const cwd     = resolveCwd(payload);
    const { policy } = loadPolicy(cwd);
    const cfg     = asObject(policy.stop);

    // ── Emergency bypass ────────────────────────────────────────────────────
    if (process.env[String(cfg.bypassEnv || "SY_BYPASS_STOP_GUARD")] === "1") {
      return allow();
    }

    // ── Lock guard ──────────────────────────────────────────────────────────
    const stalenessMs = Number(cfg.lockStalenessMs) || 30_000;
    if (!acquireLock(stalenessMs)) return allow();

    try {
      await runGates(cwd, policy, cfg);
    } finally {
      releaseLock();
    }
  } catch {
    releaseLock();
    // On unexpected error: always allow (fail open for Stop)
    return allow();
  }
})();

async function runGates(cwd, policy, cfg) {
  const state = loadWorkflowState(cwd, policy);

  // ── Phase passthrough ────────────────────────────────────────────────────
  const passPhases = Array.isArray(cfg.passPhases) ? cfg.passPhases : [
    "done","explore","exploring","benchmark","benchmarking",
    "free-ideation","design","designing","brainstorm","ideation","",
  ];
  if (!state.exists || passPhases.includes(state.phase)) {
    return allow();
  }

  // ── Parse error in active phase ──────────────────────────────────────────
  if (state.parseError) {
    return block(
      "sy-stop",
      "workflow session parse error — cannot verify completion state",
      [
        `session: ${state.sessionPath}`,
        "Fix the session file or set SY_BYPASS_STOP_GUARD=1 to override.",
        "See: sy-constraints/execution",
      ],
    );
  }

  const failures = [];
  const reportPath  = path.join(cwd, String(cfg.reportRelativePath || ".ai/analysis/ai.report.json"));
  const maxAgeHours = Number(cfg.maxReportAgeHours) || 6;

  // ── Plan phase ────────────────────────────────────────────────────────────
  if (state.phase === "plan") {
    if (!state.fields?.updated_at) {
      failures.push("session.yaml missing updated_at — save session state before stopping");
    }
  }

  // ── Execute phase ─────────────────────────────────────────────────────────
  if (state.phase === "execute") {
    // Require at least one audited write (proves PostToolUse ran)
    if (!auditExists(cwd)) {
      failures.push(
        "audit.jsonl not found — PostToolUse hook may not have run; " +
        "re-run with hooks enabled or set SY_BYPASS_STOP_GUARD=1",
      );
    }

    // If a node was completed, require verification evidence
    const lastNode = String(state.fields?.last_completed_node || "").trim();
    if (lastNode && lastNode.toLowerCase() !== "none") {
      const report = loadReport(reportPath);
      if (!report) {
        failures.push(
          `node '${lastNode}' is marked complete but ai.report.json is missing — ` +
          "run verification before claiming node done. See: sy-constraints/verify",
        );
      } else if (reportIsStale(report, maxAgeHours)) {
        failures.push(
          `node '${lastNode}' verification report is stale (>${maxAgeHours}h) — ` +
          "re-run verification. See: sy-constraints/verify",
        );
      } else {
        const states = verificationStates(report);
        if (Object.values(states).includes("fail")) {
          failures.push(
            `verification has FAIL state(s): ${JSON.stringify(states)} — ` +
            "fix failures before stopping. See: sy-constraints/verify",
          );
        }
        if (Object.values(states).every((v) => v === "skip")) {
          failures.push(
            "all verification checks are 'skip' — no PASS evidence for completed node. " +
            "See: sy-constraints/verify",
          );
        }
      }
    }

    // Require next_action to be set (phase continuity)
    if (!state.nextAction) {
      failures.push(
        "session.yaml missing next_action — set before stopping so work can resume. " +
        "See: sy-constraints/phase (checkpoint policy)",
      );
    }
  }

  // ── Review phase ──────────────────────────────────────────────────────────
  if (state.phase === "review") {
    const report = loadReport(reportPath);
    if (!report) {
      failures.push(
        "ai.report.json not found — generate verification report before review stop. " +
        "See: sy-constraints/verify",
      );
    } else if (reportIsStale(report, maxAgeHours)) {
      failures.push(
        `ai.report.json is stale (>${maxAgeHours}h) — regenerate before completing review. ` +
        "See: sy-constraints/verify",
      );
    }

    // Ledger coverage gate (verification-before-completion SKILL.md §Step 3)
    // Every completed node must have a ledger entry — missing entries mean
    // execute-verify was skipped for that node.
    const totalNodes = parseInt(String(state.fields?.total_nodes || "0"), 10) || 0;
    if (totalNodes > 0) {
      const { count: ledgerCount, nodeIds } = countLedgerNodes(cwd);
      if (ledgerCount < totalNodes) {
        failures.push(
          `ledger coverage: ${ledgerCount}/${totalNodes} nodes have ledger entries — ` +
          `run /execute verify for node(s) missing from ledger. ` +
          `Verified: [${nodeIds.join(", ") || "none"}]. ` +
          "See: verification-before-completion (Step 3 — ledger audit)",
        );
      }
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  if (failures.length > 0) {
    return block(
      "sy-stop",
      "CHECKPOINT INCOMPLETE",
      [
        `phase: ${state.phase}  next_action: ${state.nextAction || "(not set)"}`,
        ...failures.map((f, i) => `  [${i + 1}] ${f}`),
        "",
        "Resolve the above before stopping, or use SY_BYPASS_STOP_GUARD=1.",
      ],
    );
  }

  // Emit advisory context if stopping with a pending workflow (not blocking)
  if (state.hasPending) {
    return allow(
      `[sy-stop] Session stop with active workflow: phase=${state.phase} next=${state.nextAction}. ` +
      "Checkpoint passed. Use `工作流 继续` to resume.",
    );
  }

  return allow();
}

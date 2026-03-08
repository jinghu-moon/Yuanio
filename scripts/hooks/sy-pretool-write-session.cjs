#!/usr/bin/env node
"use strict";
/**
 * sy-pretool-write-session.cjs
 * Event:   PreToolUse  (matcher: Write|Edit)
 * Purpose: Guard writes to the workflow session state file.
 *          Canonical state lives in session.yaml with legacy session.md fallback.
 *          The session file is parsed by hooks (sy-stop, sy-pretool-write, sy-prompt-refresh,
 *          sy-pretool-bash-budget). A corrupted or semantically invalid session file
 *          silently breaks all downstream hook behavior.
 *
 * Skill alignment: sy-workflow (start.md / continue.md / status.md)
 *   All three operations write session state. This hook validates the write at the
 *   boundary so errors surface immediately rather than at the next hook invocation.
 *
 * Gates (in order):
 *   Gate 1 — Only fires for session state writes (all other paths pass through)
 *   Gate 2 — current_phase must be in the legal enum
 *   Gate 3 — Phase transition must not be a silent regression
 *             (review → execute or done → execute without a run_id change)
 *   Gate 4 — run_id format sanity (wf-YYYYMMDD-NNN)
 *
 * Exit semantics:
 *   exit 0  — valid write, allow
 *   exit 2  — invalid write, block with specific field/value that failed
 *
 * Bypass: SY_BYPASS_SESSION_GUARD=1
 *
 * sy-constraints alignment:
 *   sy-constraints/truth  — machine-readable state must be ground truth
 *   sy-constraints/phase  — valid phase transitions only
 */

const fs   = require("node:fs");
const path = require("node:path");

const { asObject, allow, block, warn, loadPolicy, loadWorkflowState,
        parseJsonSafe, parseSessionFields, readStdin,
        resolveCwd, resolveFilePath, resolveContent } = require("./sy-hook-lib.cjs");

// Legal phase values (from session.yaml Schema v2 + legacy aliases)
const LEGAL_PHASES = new Set([
  "exploring", "benchmarking", "free-ideation", "designing",
  "plan", "execute", "review", "done",
  // legacy aliases (tolerated)
  "explore", "benchmark", "design", "brainstorm", "ideation", "",
]);

// Phase transitions that are suspicious without a new run_id
// Maps: from → Set of phases that should not be written silently
const REGRESSION_MAP = {
  "review": new Set(["plan", "execute"]),   // going back from review
  "done":   new Set(["plan", "execute", "review"]),  // undoing completion
};

const RUN_ID_PATTERN = /^wf-\d{8}-\d{3}$/;

function isSessionFile(filePath, cwd) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith(".ai/workflow/session.md") ||
         normalized.endsWith(".ai/workflow/session.yaml");
}

function extractPhase(content) {
  // Find current_phase: <value>  (with or without - prefix)
  const m = content.match(/^[\s\-]*current_phase\s*:\s*(\S+)/im);
  return m ? m[1].trim().toLowerCase().replace(/['"]/g, "") : null;
}

function extractRunId(content) {
  const m = content.match(/^[\s\-]*run_id\s*:\s*(\S+)/im);
  return m ? m[1].trim().replace(/['"` ]/g, "") : null;
}

(async () => {
  try {
    if (process.env["SY_BYPASS_SESSION_GUARD"] === "1" ||
        process.env["SY_BYPASS_PRETOOL_WRITE"] === "1") {
      return allow();
    }

    const raw      = await readStdin();
    const payload  = asObject(parseJsonSafe(raw, {}));
    const cwd      = resolveCwd(payload);
    const filePath = resolveFilePath(payload);
    const content  = resolveContent(payload);

    // ── Gate 1: Only session state writes ────────────────────────────────────
    if (!isSessionFile(filePath, cwd)) return allow();

    // For Edit operations, new_string may be a fragment — be lenient
    const isEdit = String(payload.tool_name || payload.tool || "").toLowerCase() === "edit";

    // ── Gate 2: Validate current_phase ───────────────────────────────────────
    const newPhase = extractPhase(content);

    if (newPhase !== null) {
      if (!LEGAL_PHASES.has(newPhase)) {
        return block(
          "sy-pretool-write-session",
          `Invalid current_phase value: "${newPhase}"`,
          [
            `file: ${filePath}`,
            `Legal values: ${[...LEGAL_PHASES].filter(Boolean).join(" | ")}`,
            "Correct the phase value before writing session.yaml (legacy session.md is still accepted).",
            "See: sy-workflow (phase enum) + sy-constraints/phase",
          ],
        );
      }
    }

    // ── Gate 3: Phase regression check ───────────────────────────────────────
    // Only check when we know both the current on-disk phase and the new phase
    if (newPhase && !isEdit) {
      const { policy } = loadPolicy(cwd);
      const current = loadWorkflowState(cwd, policy);

      if (current.exists && current.phase && REGRESSION_MAP[current.phase]) {
        const regressionTargets = REGRESSION_MAP[current.phase];

        if (regressionTargets.has(newPhase)) {
          // Check if run_id changed — if it did, this is a new session (legitimate)
          const onDiskRunId = String(asObject(current.fields).run_id || "").trim();
          const newRunId    = extractRunId(content);

          if (!newRunId || newRunId === onDiskRunId) {
            // Same session, going backwards — this is a rework decision, not corruption
            // WARN (not block): rework is valid but should be explicit
            warn(
              "sy-pretool-write-session",
              `Phase regression: ${current.phase} → ${newPhase} (same run_id)`,
              [
                `file: ${filePath}`,
                "This reverses a phase transition. Expected during /review-feedback (REWORK verdict).",
                "If intentional: set SY_BYPASS_SESSION_GUARD=1 to suppress this warning.",
                "See: sy-workflow/operations/continue.md + requesting-code-review (REWORK verdict)",
              ],
            );
            // Allow — regression is legitimate during REWORK flow
          }
        }
      }
    }

    // ── Gate 4: run_id format ─────────────────────────────────────────────────
    const newRunId = extractRunId(content);
    if (newRunId && !RUN_ID_PATTERN.test(newRunId)) {
      return block(
        "sy-pretool-write-session",
        `Invalid run_id format: "${newRunId}"`,
        [
          `file: ${filePath}`,
          "Expected format: wf-YYYYMMDD-NNN  (e.g. wf-20260307-001)",
          "See: sy-workflow/operations/start.md Step 4",
        ],
      );
    }

    return allow();

  } catch {
    // Never block on hook error
    return allow();
  }
})();

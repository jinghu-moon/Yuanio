#!/usr/bin/env node
"use strict";
/**
 * sy-pretool-write.cjs
 * Event:   PreToolUse  (matcher: Write|Edit)
 * Purpose: Three-gate pre-write guard enforcing sy-constraints discipline
 *          before any file is written.
 *
 * Gates (in order, each can independently block):
 *
 *   Gate 1 — Protected files (sy-constraints/execution + appsec)
 *     Block writes to .env*, lock files, and other files that should never
 *     be agent-modified directly.
 *
 *   Gate 2 — TDD red gate (sy-constraints/testing)
 *     If the current workflow node has tdd_required=true and red_verified=false,
 *     block production-code writes until the agent has first written and confirmed
 *     a failing test.
 *
 *   Gate 3 — Secrets scan (sy-constraints/appsec)
 *     Block writes containing high-confidence secret patterns or hardcoded
 *     credential assignments not behind an env-var accessor.
 *
 *   Gate 4 — Placeholder / stub gate (executing-plans + verification-before-completion)
 *     Block production-code writes that contain TODO/FIXME/HACK/unimplemented!/todo!()
 *     markers in newly written lines, signalling incomplete implementation.
 *     Test files are exempt (TODOs in tests are allowed notes, not stubs).
 *
 *   Gate 5 — Debug Iron Law (systematic-debugging)
 *     When debug_active=true AND debug_phase < 5, block ALL source-file writes.
 *     Systematic debugging requires phases 1-4 (evidence → repro → isolate →
 *     hypothesize) to complete before any code change may be made (phase 5).
 *     Skip this gate for: session.yaml, legacy session.md, ledger.md, and evidence files.
 *
 * Exit semantics:
 *   exit 0  — allow
 *   exit 2  — block; stderr text is returned to Claude as context
 *
 * Emergency bypass: SY_BYPASS_PRETOOL_WRITE=1
 */

const fs   = require("node:fs");
const path = require("node:path");

const { asObject, allow, block, compilePattern,
        loadPolicy, loadWorkflowState, loadDebugState, parseSessionFields,
        parseJsonSafe, readStdin,
        resolveCwd, resolveContent, resolveFilePath,
        scanSecrets }  = require("./sy-hook-lib.cjs");

// ── Helper: is file path production code (not test / spec)? ──────────────────
const TEST_PATTERNS = [/[._-]test[._/-]/, /[._-]spec[._/-]/, /__tests?__/, /\.test\.[a-z]+$/, /\.spec\.[a-z]+$/];
function isProductionCode(filePath) {
  return !TEST_PATTERNS.some((re) => re.test(filePath));
}

(async () => {
  const raw     = await readStdin();
  const payload = asObject(parseJsonSafe(raw, {}));
  const cwd     = resolveCwd(payload);
  const { policy } = loadPolicy(cwd);
  const cfg     = asObject(policy.pretoolWrite);

  // ── Emergency bypass ──────────────────────────────────────────────────────
  const bypass = String(cfg.bypassEnv || "SY_BYPASS_PRETOOL_WRITE");
  if (process.env[bypass] === "1") return allow();

  // ── Tool filter ───────────────────────────────────────────────────────────
  const toolName = String(payload.tool_name || payload.tool || "").toLowerCase();
  if (!/(write|edit)/i.test(toolName)) return allow();

  const filePath = resolveFilePath(payload);
  const content  = resolveContent(payload);

  // ─────────────────────────────────────────────────────────────────────────
  // Gate 1: Protected files
  // ─────────────────────────────────────────────────────────────────────────
  const protectedFiles = Array.isArray(cfg.protectedFiles) ? cfg.protectedFiles : [];
  for (const item of protectedFiles) {
    const pf    = asObject(item);
    const regex = compilePattern(pf.pattern, "i");
    if (regex && regex.test(filePath)) {
      return block(
        "sy-pretool-write/gate1-protected",
        `protected file — do not write directly: ${filePath} (${String(pf.label || "protected")})`,
        ["Use the appropriate CLI command or update via project tooling.",
         "See: sy-constraints/execution"],
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gate 2: TDD red gate
  // ─────────────────────────────────────────────────────────────────────────
  if (cfg.tddGateEnabled !== false && filePath && isProductionCode(filePath)) {
    const state = loadWorkflowState(cwd, policy);
    if (state.exists && state.phase === "execute" && state.fields) {
      const tddRequired  = String(state.fields.tdd_required  || "").toLowerCase();
      const redVerified  = String(state.fields.red_verified  || "").toLowerCase();
      if (tddRequired === "true" && redVerified !== "true") {
        return block(
          "sy-pretool-write/gate2-tdd",
          "TDD red gate: tdd_required=true but red_verified is not set to true",
          [
            `file: ${filePath}`,
            "Write and run a FAILING test first, then set red_verified=true in session state.",
            "See: sy-constraints/testing (Iron Law — write the failing test first)",
          ],
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gate 3: Secrets scan
  // ─────────────────────────────────────────────────────────────────────────
  if (content) {
    const result = scanSecrets(content, policy.secrets);
    if (result.blocked) {
      return block(
        "sy-pretool-write/gate3-secrets",
        `secret pattern detected: ${result.name}`,
        [
          filePath ? `file: ${filePath}` : "",
          "Use environment variables instead: process.env.SECRET / os.environ['KEY'] / std::env::var(\"KEY\")",
          "See: sy-constraints/appsec (secrets never in code)",
        ].filter(Boolean),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gate 4: Placeholder / stub gate
  // ─────────────────────────────────────────────────────────────────────────
  // Only applies to production code writes (not test files, not .md, not config)
  if (content && filePath && isProductionCode(filePath) && !/\.(md|yaml|yml|json|toml)$/i.test(filePath)) {
    // Scan only the lines being written (new content), not context
    // Match TODO/FIXME/HACK as comment markers or Rust/JS unimplemented macros
    const PLACEHOLDER_RE = /^\+?.*\b(TODO|FIXME|HACK|unimplemented!\s*\(|todo!\s*\(|raise\s+NotImplementedError|panic!\s*\("not\s+implemented)/m;
    // Exception: allow  // TODO(tracked): #123  or  // TODO(issue: #456)  style (has issue ref)
    const TRACKED_RE    = /TODO\s*\(\s*[^)]*\)\s*:?\s*#\d+|TODO\s*\([^)]*#\d+/;
    if (PLACEHOLDER_RE.test(content) && !TRACKED_RE.test(content)) {
      return block(
        "sy-pretool-write/gate4-placeholder",
        "incomplete implementation: placeholder/stub marker in production code",
        [
          filePath ? `file: ${filePath}` : "",
          "Remove TODO/FIXME/HACK/unimplemented!() before writing.",
          "If deferring intentionally: add a tracked issue ref  TODO(defer): #NNN",
          "and declare it as a new plan node in plan.md.",
          "See: executing-plans (nodes must be complete) + verification-before-completion",
        ].filter(Boolean),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gate 5: Debug Iron Law
  // ─────────────────────────────────────────────────────────────────────────
  // Skip for: session state, ledger, and evidence files (they are allowed)
  const isEvidenceFile = /\.(md|jsonl|json|yaml|yml|txt|log)$/i.test(filePath);
  if (!isEvidenceFile && filePath) {
    // Reuse `state` loaded for Gate 2 — same file, no need to re-read disk.
    // `state` is defined in Gate 2 scope; if Gate 2 was skipped (tddGateEnabled=false
    // or not production code), state may be undefined — load lazily.
    const gateState = (typeof state !== "undefined" && state)
      ? state
      : loadWorkflowState(cwd, policy);
    if (gateState.exists && gateState.fields) {
      const dbg = loadDebugState(gateState.fields);
      if (dbg.active && dbg.phase !== null && dbg.phase < 5) {
        return block(
          "sy-pretool-write/gate5-debug-iron-law",
          `debug Iron Law: cannot write source code at phase ${dbg.phase}/5`,
          [
            filePath ? `file: ${filePath}` : "",
            "Systematic debugging requires phases 1-4 (evidence → reproduce → isolate →",
            "hypothesize) to complete before any code change.",
            `Current: phase=${dbg.phase}  hypotheses_tried=${dbg.hypothesisCount}`,
            dbg.nodeId ? `debug_node: ${dbg.nodeId}` : "",
            "Complete phases 1-4, then set debug_phase=5 in session.yaml (legacy session.md also works) to proceed.",
            "See: systematic-debugging/SKILL.md (Iron Law)",
          ].filter(Boolean),
        );
      }
    }
  }

  return allow();
})();

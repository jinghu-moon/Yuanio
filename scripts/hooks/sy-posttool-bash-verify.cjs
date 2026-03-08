#!/usr/bin/env node
"use strict";
/**
 * sy-posttool-bash-verify.cjs
 * Event:   PostToolUse  (matcher: Bash)
 * Purpose: Capture verification phase evidence (build/type/lint/test/security)
 *          into .ai/analysis/verify-staging.json.
 *          When verification-before-completion writes ai.report.json, it can
 *          read from this staging file to populate the verification block
 *          with real command evidence rather than relying on Claude's memory.
 *
 * Skill alignment:
 *   verification-before-completion (SKILL.md — Step 2 + Step 4)
 *     The skill runs 6 phases and writes ai.report.json. This hook auto-captures
 *     each phase result as it happens, making the final report assembly more
 *     reliable — Claude doesn't need to remember 6 separate command outputs.
 *
 *   systematic-debugging (SKILL.md — Phase 5c)
 *     Bug fix verify commands also flow through here, giving /debug confirmation
 *     evidence without extra instrumentation.
 *
 * Captured per command:
 *   - phase (build | typecheck | lint | test | security | verify)
 *   - command (exact string)
 *   - exit_code
 *   - status (pass | fail)
 *   - key_signal (first matching pass/fail indicator from output)
 *   - timestamp
 *   - node_id (from session.yaml current_node if in execute phase)
 *
 * Staging file: .ai/analysis/verify-staging.json
 *   Schema: { updated_at, session_run_id, phases: { build, typecheck, lint, test, security, verify } }
 *   Each phase entry: { command, exit_code, status, key_signal, ts }
 *   Latest result per phase overwrites previous (rolling update within a session).
 *
 * Exit semantics:
 *   exit 0 always — PostToolUse MUST NOT block the primary flow.
 *
 * Bypass: SY_BYPASS_VERIFY_CAPTURE=1
 *
 * sy-constraints alignment:
 *   sy-constraints/verify — "no completion claim without fresh verification evidence"
 *   sy-constraints/truth  — evidence is ground truth, not memory
 */

const fs   = require("node:fs");
const path = require("node:path");

const { asObject, loadWorkflowState, loadPolicy,
        parseJsonSafe, readStdin, resolveCwd } = require("./sy-hook-lib.cjs");

// Command → phase classifier
const PHASE_CLASSIFIERS = [
  // build
  { phase: "build",     patterns: [/\bcargo\s+build\b/i, /\bnpm\s+run\s+build\b/i, /\bvite\s+build\b/i, /\bgo\s+build\b/i] },
  // typecheck (before test — tsc/vue-tsc are typecheck-only)
  { phase: "typecheck", patterns: [/\bcargo\s+check\b/i, /\btsc\s+--no-emit\b/i, /\bvue-tsc\b/i, /\bgo\s+vet\b/i, /\bmypy\b/i] },
  // lint
  { phase: "lint",      patterns: [/\bcargo\s+clippy\b/i, /\beslint\b/i, /\bruff\s+check\b/i, /\bflake8\b/i, /\bgolangci-lint\b/i] },
  // test (after lint — test commands are broader, check lint first)
  { phase: "test",      patterns: [/\bcargo\s+test\b/i, /\bnpm\s+test\b/i, /\bvitest\s+run\b/i, /\bpytest\b/i, /\bgo\s+test\b/i, /\bjest\b/i, /\bmocha\b/i] },
  // security
  { phase: "security",  patterns: [/\bcargo\s+audit\b/i, /\bnpm\s+audit\b/i, /\btrufflehog\b/i, /\bgitleaks\b/i, /\bsemgrep\b/i] },
];

// Pass/fail signal extraction: check first 20 lines + last 10 lines of combined output
const PASS_SIGNALS = [
  /\b0\s+(errors?|failed|failures?)\b/i,
  /\bfinished\b.*\b0\s+errors?\b/i,
  /\ball\s+tests?\s+pass(ed)?\b/i,
  /\btest\s+result\b.*\bok\b/i,
  /\bBUILD\s+SUCCESSFUL\b/i,
  /\bbuilt\s+in\b/i,
  /\bno\s+(issues?|errors?|warnings?)\s+found\b/i,
];

const FAIL_SIGNALS = [
  /\b\d+\s+(errors?|failures?|failed)\b/i,
  /\bBUILD\s+FAILED\b/i,
  /\berror\[E\d+\]/i,
  /\bFAILED\b/,
  /\btest\s+result\b.*\bFAILED\b/i,
];

function classifyPhase(command) {
  for (const { phase, patterns } of PHASE_CLASSIFIERS) {
    if (patterns.some(p => p.test(command))) return phase;
  }
  return null;
}

function extractKeySignal(stdout, stderr, exitCode) {
  const combined = [stdout, stderr].join("\n");
  const lines    = combined.split("\n");
  // Check last 20 lines (where summaries usually are) + first 5
  const sample   = [...lines.slice(0, 5), ...lines.slice(-20)].join("\n");

  if (exitCode === 0) {
    for (const pattern of PASS_SIGNALS) {
      const m = sample.match(pattern);
      if (m) return m[0].trim().slice(0, 100);
    }
    return "exit 0";
  } else {
    for (const pattern of FAIL_SIGNALS) {
      const m = sample.match(pattern);
      if (m) return m[0].trim().slice(0, 100);
    }
    // Return first error line as signal
    const errLine = lines.find(l => /error|FAIL/i.test(l) && l.trim());
    return errLine ? errLine.trim().slice(0, 100) : `exit ${exitCode}`;
  }
}

function readStaging(stagingPath) {
  try {
    if (!fs.existsSync(stagingPath)) return {};
    return JSON.parse(fs.readFileSync(stagingPath, "utf8"));
  } catch { return {}; }
}

function writeStaging(stagingPath, data) {
  try {
    fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
    fs.writeFileSync(stagingPath, JSON.stringify(data, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

/**
 * If ai.report.json exists and its verification block for this phase is stale
 * (the staging entry is newer), update the report in-place.
 */
function syncToReport(reportPath, phase, phaseEntry) {
  try {
    if (!fs.existsSync(reportPath)) return;
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!report.verification) return;

    const status = phaseEntry.status; // "pass" | "fail"
    // Map phase name to report field name
    const fieldMap = { build: "build", typecheck: "compile", lint: "lint", test: "test", security: null };
    const field    = fieldMap[phase];
    if (!field) return;

    report.verification[field]  = status;
    report.updated_at           = new Date().toISOString();

    // If any phase is now "fail", flip overall to NOT_READY
    const verif    = report.verification;
    const hasFail  = ["compile","test","lint","build"].some(k => verif[k] === "fail");
    if (hasFail) report.overall = "NOT_READY";

    // Update evidence array
    if (Array.isArray(report.evidence)) {
      const idx = report.evidence.findIndex(e => e.phase === phase);
      const entry = { phase, command: phaseEntry.command, exit_code: phaseEntry.exit_code, signal: phaseEntry.key_signal };
      if (idx >= 0) report.evidence[idx] = entry;
      else report.evidence.push(entry);
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

(async () => {
  try {
    if (process.env["SY_BYPASS_VERIFY_CAPTURE"] === "1") {
      process.stdout.write("{}");
      return;
    }

    const raw     = await readStdin();
    const payload = asObject(parseJsonSafe(raw, {}));
    const cwd     = resolveCwd(payload);
    const { policy } = loadPolicy(cwd);

    // ── Extract command and result ────────────────────────────────────────────
    const input      = asObject(payload.tool_input ?? payload.input ?? {});
    const command    = String(input.command || input.cmd || "").trim();
    if (!command) { process.stdout.write("{}"); return; }

    const response   = asObject(payload.tool_response ?? payload.tool_result ?? {});
    const exitCode   = Number(response.returncode ?? response.exit_code ?? response.exitCode ?? -1);
    const stdout     = String(response.stdout || "");
    const stderr     = String(response.stderr || "");

    // ── Classify phase ────────────────────────────────────────────────────────
    const phase = classifyPhase(command);
    if (!phase) { process.stdout.write("{}"); return; }

    // ── Load session context ──────────────────────────────────────────────────
    const state    = loadWorkflowState(cwd, policy);
    const fields   = asObject(state.fields);
    const runId    = String(fields.run_id || "").trim();
    const nodeId   = String(fields.id || fields.current_node_id || "").trim();

    const stagingPath = path.join(cwd, ".ai/analysis/verify-staging.json");
    const reportPath  = path.join(cwd, ".ai/analysis/ai.report.json");

    // ── Build phase entry ─────────────────────────────────────────────────────
    const phaseEntry = {
      command,
      exit_code:  exitCode,
      status:     exitCode === 0 ? "pass" : "fail",
      key_signal: extractKeySignal(stdout, stderr, exitCode),
      ts:         new Date().toISOString(),
      node:       nodeId || undefined,
    };

    // ── Update staging file ───────────────────────────────────────────────────
    const staging = readStaging(stagingPath);

    // Clear stale entries when a new session starts.
    // Without this, a session 2 that only runs `cargo build` would still see
    // `test=fail` from session 1 in the staging file — contaminating ai.report.json.
    if (!staging.phases) staging.phases = {};
    if (runId && staging.session_run_id && staging.session_run_id !== runId) {
      staging.phases = {};
    }

    staging.phases[phase] = phaseEntry;
    staging.updated_at    = phaseEntry.ts;
    staging.session_run_id = runId || staging.session_run_id;
    writeStaging(stagingPath, staging);

    // ── Sync to ai.report.json if it already exists ───────────────────────────
    syncToReport(reportPath, phase, phaseEntry);

  } catch { /* non-fatal */ }

  process.stdout.write("{}");
  process.exit(0);
})();

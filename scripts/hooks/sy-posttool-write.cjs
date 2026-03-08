#!/usr/bin/env node
"use strict";
/**
 * sy-posttool-write.cjs
 * Event:   PostToolUse  (matcher: Write|Edit)
 * Purpose: Non-blocking post-write housekeeping.
 *
 * Actions (all non-blocking — never exit 2):
 *   1. Append audit entry to .ai/workflow/audit.jsonl
 *      → Provides the Stop hook with evidence that writes happened this session.
 *   2. Invalidate .ai/index.json understanding confidence for the changed file
 *      → Prevents stale code-insight analysis from being treated as authoritative.
 *   3. Warn via stderr on MEDIUM-confidence secret patterns (not caught by Gate 3
 *      because they're ambiguous — e.g. a 20-char alphanumeric in a config key).
 *      → Advisory only. No block.
 *   4. Detect session.yaml last_completed_node change → write VERIFY_PASS to audit.jsonl
 *      → Feeds sy-pretool-bash-budget.cjs countVerifiedNodes() so loop budget
 *         tracking is accurate. Fires only when the field value changes.
 *   5. Scope drift detection (executing-plans — execute-node.md Step 4 self-reflection)
 *      → If the written file is outside current_node.target, warn via stderr.
 *      → Advisory only. Never blocks (scope drift may be intentional).
 *      → Skips: session state, ledger.md, and evidence files.
 *
 * Exit semantics:
 *   exit 0 always — PostToolUse MUST NOT block the primary flow.
 *
 * sy-constraints alignment:
 *   - audit.jsonl supports sy-constraints/verify (evidence trail)
 *   - index invalidation supports sy-constraints/truth (fresh evidence only)
 *   - medium-confidence warn supports sy-constraints/appsec (advisory)
 */

const fs   = require("node:fs");
const path = require("node:path");
const os   = require("node:os");

const { asObject, warn, isInsideTarget,
        loadPolicy, loadWorkflowState, parseJsonSafe, readStdin,
        resolveCwd, resolveContent, resolveFilePath } = require("./sy-hook-lib.cjs");

// Medium-confidence patterns: warn but never block
const MEDIUM_CONFIDENCE = [
  { name: "long alphanumeric assignment", regex: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'`]?([A-Za-z0-9+/]{32,})["'`]?/i },
  { name: "bearer token in string",       regex: /["']Bearer\s+[A-Za-z0-9._\-]{20,}["']/i },
];

function computeFingerprint(filePath) {
  try {
    const s = fs.statSync(filePath);
    return `stat:${s.size}-${Math.floor(s.mtimeMs)}`;
  } catch { return "deleted"; }
}

function updateIndex(indexPath, filePath, projectDir) {
  try {
    if (!fs.existsSync(indexPath)) return;
    const index   = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const relPath = path.relative(projectDir, filePath).replace(/\\/g, "/");
    const files   = asObject(index.files);
    if (!(relPath in files)) return;

    const entry = asObject(files[relPath]);
    entry.previous_fingerprint = entry.fingerprint;
    entry.fingerprint = computeFingerprint(filePath);
    entry.status = "MODIFIED";

    const understanding = asObject(entry.understanding);
    understanding.confidence = 0.0;
    const blindSpots = Array.isArray(understanding.blind_spots) ? understanding.blind_spots : [];
    blindSpots.push("File modified after last analysis — re-run /understand <path>.");
    understanding.blind_spots = blindSpots;
    entry.understanding = understanding;

    files[relPath] = entry;
    index.files = files;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

function appendAudit(auditPath, entry) {
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, JSON.stringify(entry) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

(async () => {
  try {
    const raw      = await readStdin();
    const payload  = asObject(parseJsonSafe(raw, {}));
    const cwd      = resolveCwd(payload);
    const { policy } = loadPolicy(cwd);
    const filePath = resolveFilePath(payload);
    const content  = resolveContent(payload);
    const toolName = String(payload.tool_name || payload.tool || "");

    // 1. Audit log
    appendAudit(path.join(cwd, ".ai/workflow/audit.jsonl"), {
      ts:    new Date().toISOString(),
      event: "PostToolUse",
      tool:  toolName,
      file:  filePath,
      fp:    filePath ? computeFingerprint(path.resolve(cwd, filePath)) : null,
    });

    // 2. Index invalidation
    if (filePath) {
      updateIndex(
        path.join(cwd, ".ai/index.json"),
        path.resolve(cwd, filePath),
        cwd,
      );
    }

    // 3. Medium-confidence secret warning
    if (content) {
      for (const { name, regex } of MEDIUM_CONFIDENCE) {
        if (regex.test(content)) {
          warn("sy-posttool-write", `possible credential pattern in write — verify it is env-var backed: ${name}`,
               [filePath ? `file: ${filePath}` : "", "See: sy-constraints/appsec"].filter(Boolean));
          break; // one warning per write is enough
        }
      }
    }

    // 4. VERIFY_PASS event — fires when session.yaml last_completed_node is set to a valid node ID.
    //    This feeds sy-pretool-bash-budget countVerifiedNodes() for loop budget tracking.
    //
    //    NOTE: We do NOT compare against previous file content here. PostToolUse fires AFTER
    //    the Write completes, meaning readFileSync would return the new content (same as
    //    `content`), making the comparison always false. Instead we fire unconditionally
    //    when newNode is a valid node ID. countVerifiedNodes() uses a Set, so duplicate
    //    events for the same node ID are deduplicated — no overcounting.
    const isSessionFile = /\.ai[\\/]workflow[\\/]session\.(md|yaml)$/i.test(
      filePath.replace(/\\/g, "/")
    );
    if (isSessionFile && content) {
      const newNode = (content.match(/^[\s\-]*last_completed_node\s*:\s*(\S+)/im) || [])[1] || "";
      if (newNode && !/^(none|null|-)$/i.test(newNode)) {
        appendAudit(path.join(cwd, ".ai/workflow/audit.jsonl"), {
          ts:    new Date().toISOString(),
          event: "VERIFY_PASS",
          node:  newNode,
        });
      }
    }

    // 5. Scope drift detection — warn when written file is outside current_node.target
    //    Skip evidence/config files (only matters for source + test writes)
    const isEvidenceFile = /\.(md|jsonl|json|yaml|yml|txt|log)$/i.test(filePath);
    if (!isEvidenceFile && filePath) {
      const state = loadWorkflowState(cwd, policy);
      if (state.exists && state.phase === "execute" && state.fields) {
        const target = String(state.fields.target || "").trim();
        if (target) {
          const inside = isInsideTarget(filePath, target, cwd);
          if (inside === false) {
            warn(
              "sy-posttool-write/scope-drift",
              `file written outside current_node.target`,
              [
                `written:  ${filePath}`,
                `target:   ${target}`,
                "If intentional: declare this as scope change in checkpoint.",
                "See: executing-plans/operations/execute-node.md Step 4 (self-reflection)",
              ],
            );
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  process.stdout.write("{}");
  process.exit(0);
})();

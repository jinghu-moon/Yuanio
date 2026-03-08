#!/usr/bin/env node
"use strict";
/**
 * sy-pretool-bash.cjs
 * Event:   PreToolUse  (matcher: Bash)
 * Purpose: Deterministic enforcement of sy-constraints/safety and
 *          sy-constraints/execution at the command execution boundary.
 *
 * Enforces (in order):
 *   1. Blocked destructive commands  (sy-constraints/safety)
 *   2. Unauthorized git commit       (sy-constraints/execution)
 *   3. Unauthorized git push         (sy-constraints/execution + safety)
 *
 * Exit semantics:
 *   exit 0  — allow
 *   exit 2  — block; stderr text is returned to Claude as context
 *
 * All rules are overridable via environment variables documented in README.
 * Emergency bypass: SY_BYPASS_PRETOOL_BASH=1
 */

const { asObject, allow, block, compilePattern,
        loadPolicy, parseJsonSafe, readStdin,
        resolveCwd, resolveInput }  = require("./sy-hook-lib.cjs");

(async () => {
  const raw     = await readStdin();
  const payload = asObject(parseJsonSafe(raw, {}));
  const cwd     = resolveCwd(payload);
  const { policy } = loadPolicy(cwd);
  const cfg = asObject(policy.pretoolBash);

  // ── Emergency bypass ──────────────────────────────────────────────────────
  const bypass = String(cfg.bypassEnv || "SY_BYPASS_PRETOOL_BASH");
  if (process.env[bypass] === "1") return allow();

  // ── Tool filter ───────────────────────────────────────────────────────────
  const toolName = String(payload.tool_name || payload.tool || "").toLowerCase();
  if (!/(bash|shell|command)/i.test(toolName)) return allow();

  const input   = resolveInput(payload);
  const command = String(input.command || input.cmd || "").trim();
  if (!command) return allow();

  // ── Gate 1: Blocked destructive commands (sy-constraints/safety) ──────────
  const blocked = Array.isArray(cfg.blockedCommands) ? cfg.blockedCommands : [];
  for (const item of blocked) {
    const rule  = asObject(item);
    const regex = compilePattern(rule.regex, "i");
    if (!regex || !regex.test(command)) continue;

    const reason = String(rule.reason || "blocked by policy");
    const cites  = String(rule.cites  || "sy-constraints/safety");
    return block(
      "sy-pretool-bash",
      reason,
      [`command: ${command}`, `see: ${cites}`],
    );
  }

  // ── Gate 2: Unauthorized git commit (sy-constraints/execution) ───────────
  // Allow --dry-run (safe). Block everything else.
  const commitAllowEnv = String(cfg.commitAllowEnv || "SY_ALLOW_GIT_COMMIT");
  if (
    /\bgit\s+commit\b(?![\s\S]*\b--dry-run\b)/i.test(command) &&
    process.env[commitAllowEnv] !== "1"
  ) {
    return block(
      "sy-pretool-bash",
      `git commit requires explicit session authorization — set ${commitAllowEnv}=1`,
      [
        `command: ${command}`,
        "Stage changes and ask the user to review before committing.",
        "See: sy-constraints/execution (commit safety)",
      ],
    );
  }

  // ── Gate 3: Unauthorized git push (sy-constraints/execution + safety) ────
  const pushAllowEnv = String(cfg.pushAllowEnv || "SY_ALLOW_GIT_PUSH");
  if (
    /\bgit\s+push\b/i.test(command) &&
    process.env[pushAllowEnv] !== "1"
  ) {
    return block(
      "sy-pretool-bash",
      `git push requires explicit session authorization — set ${pushAllowEnv}=1`,
      [
        `command: ${command}`,
        "Inform the user what will be pushed and await confirmation.",
        "See: sy-constraints/execution (commit safety) + sy-constraints/safety",
      ],
    );
  }

  return allow();
})();

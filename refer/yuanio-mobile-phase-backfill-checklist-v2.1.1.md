# Yuanio Mobile v2.1.1 Blueprint Gap-Closure Checklist

- Source of Truth: `refer/yuanio-mobile-comprehensive-blueprint.md`
- Audit Basis: current repository state on `2026-03-09`
- Purpose: do **not** reopen `P0`-`P6` wholesale; only close the remaining gaps between blueprint intent and repository reality

## Status Legend

- `done`: blueprint intent is already implemented in code
- `gap`: blueprint intent is not fully closed and still needs work
- `conditional`: execute only if the verification gate fails
- `decision`: requires an explicit architectural decision, not blind code expansion

## Global Rules

- Keep `packages/shared/` and `packages/cli/src/remote/dispatch.ts` as protocol truth.
- Do not reintroduce `Hilt`, `GlobalSessionManager`, or paging engines ahead of their decision gate.
- Prefer closure by evidence: code + test + document, not code alone.
- If a phase has no mandatory code gap, close it with verification evidence instead of adding net-new features.

---

## Phase P0 - Contract Layer

- Current State: `done`
- Already Closed:
  - `ChatItem` extracted
  - `AgentEventParser` extracted
  - `todo_update` parsing is implemented
  - parser fixtures cover Claude / Codex / Gemini baseline events
- Completed In This Pass:

### P0-N5
- status: `done`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/AgentEventParser.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ToolCallCard.kt`
  - `android-app/app/src/test/java/com/yuanio/app/data/AgentEventParserTest.kt`
- action: replace raw `ToolCall.status: String` with a validated `ToolCallStatus` enum and normalize parser inputs to the 4-state contract
- why: the blueprint contract expects tool-call state convergence; current Android model still keeps protocol strings untyped
- depends_on: `[]`
- verify:
  - cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `medium`
- tdd_required: `true`
- red_cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`
- green_cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`

### P0-N6
- status: `done`
- target:
  - `android-app/app/src/test/java/com/yuanio/app/data/AgentEventParserTest.kt`
- action: extend parser fixture coverage to `turn_state`, `interaction_state`, `foreground_probe_ack`, `replay_done`, and richer `approval_req` optional fields
- why: current tests focus on core chat events, but state/control channels from the blueprint are not fully regression-locked
- depends_on: `[P0-N5]`
- verify:
  - cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `low`
- tdd_required: `true`
- red_cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`
- green_cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`

### P0-N7
- status: `done`
- target:
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
  - `android-app/app/src/test/java/com/yuanio/app/data/AgentEventParserTest.kt`
- action: freeze the Android-side error-path contract: either keep `error -> text fallback` as an explicit non-goal, or introduce a dedicated parsed error event with tests
- why: the blueprint still marks `error` as only partially aligned; this needs a documented end state instead of implicit behavior
- depends_on: `[]`
- verify:
  - cmd: `rg -n "error.*fallback|ParsedAgentEvent\.Error|STREAM_CHUNK" "refer/yuanio-mobile-comprehensive-blueprint.md" "android-app/app/src/test/java/com/yuanio/app/data/AgentEventParserTest.kt"`
  - pass_signal: `至少命中一条明确契约`
- risk_level: `low`
- tdd_required: `false`

---

## Phase P1 - Chat Model Layer

- Current State: `done`
- Mandatory Gap: `none`
- Closure Tasks:

### P1-N6
- status: `done`
- target:
  - `android-app/app/build.gradle.kts`
  - `.ai/analysis/`
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
- action: capture one fresh Compose metrics baseline and record the result as evidence for `stableKey/contentType/metrics` closure
- why: metrics output is enabled in Gradle, but the blueprint-level closure still lacks a persisted evidence artifact
- depends_on: `[]`
- verify:
  - cmd: `cd android-app && ./gradlew assembleDebug --console=plain`
  - pass_signal: `app/build/compose_metrics` contains generated reports
- risk_level: `low`
- tdd_required: `false`
- evidence:
  - `android-app/app/build/compose_metrics/debug/app-module.json` generated from a fresh `assembleDebug` build
  - baseline recorded in `.ai/analysis/20260309-p1-compose-metrics.md`

---

## Phase P2 - Input Layer

- Current State: `done`
- Mandatory Gap: `none`
- Closure Tasks:

### P2-N6
- status: `done`
- target:
  - `android-app/app/src/androidTest/java/com/yuanio/app/ui/chat/ChatInputBarTest.kt`
- action: audit the existing instrumentation matrix and补齐 slash / markdown / attachment / voice visibility assertions if any branch is still missing
- why: the code structure already converged, so the remaining work is regression hardening rather than UI rewrites
- depends_on: `[]`
- verify:
  - cmd: `cd android-app && ./gradlew :app:compileDebugAndroidTestKotlin --console=plain`
  - pass_signal: `BUILD SUCCESSFUL`
  - runtime_cmd: `cd android-app && ./gradlew connectedDebugAndroidTest --tests "*ChatInputBarTest" --console=plain`
  - runtime_note: `requires a connected device or emulator`
- risk_level: `medium`
- tdd_required: `true`
- evidence:
  - stale androidTest sources were updated to the current `InputBarState` / `MessageListCallbacks` API
  - `.ai/analysis/20260309-p2-input-tests.md` records RED -> GREEN and the no-device limitation

---

## Phase P3 - Approval Layer

- Current State: `mostly-done`
- Mandatory Gap: `none`
- Closure Tasks:

### P3-N6
- status: `done`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`
  - `android-app/app/src/test/java/com/yuanio/app/ui/component/ApprovalCardTest.kt`
- action: keep the blueprint approval-dismiss interaction and implement it with local dismiss state plus `fadeOut + scaleOut(0.97f)` over `200ms`; lock the behavior with focused dismissal-plan tests
- why: typed approval layout, diff preview, and auto-reject already exist; the remaining discrepancy was interaction polish
- depends_on: `[]`
- verify:
  - cmd: `cd android-app && ./gradlew testDebugUnitTest --tests "*ApprovalCardTest" --console=plain`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `low`
- tdd_required: `true`
- evidence:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`
  - `android-app/app/src/test/java/com/yuanio/app/ui/component/ApprovalCardTest.kt`
  - `.ai/analysis/20260309-p3-approval-dismiss.md`

---

## Phase P4 - Performance Layer

- Current State: `done-by-evidence`
- Completed In This Pass:

### P4-N5
- status: `done`
- target:
  - `.ai/analysis/`
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
- action: run the long-message and long-list verification once and record whether the current baseline already satisfies the blueprint thresholds
- why: the blueprint explicitly makes `StreamingMarkdown` and `MessageRepository` conditional; this gate must be driven by evidence, not assumption
- depends_on: `[P1-N6]`
- verify:
  - cmd: `cd android-app && ./gradlew :app:testDebugUnitTest --tests "*TerminalPerformanceTest" --console=plain --info`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `low`
- tdd_required: `false`
- evidence:
  - `.ai/analysis/20260309-p4-performance-gate.md`

### P4-N6
- status: `conditional`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/StreamingMarkdown.kt`
- action: keep `StreamingMarkdown` deferred because `P4-N5` passed and no renderer insufficiency was observed in the current baseline
- why: the blueprint marks this as a conditional optimization, not a default build-out
- depends_on: `[P4-N5]`
- verify:
  - cmd: `cd android-app && ./gradlew :app:testDebugUnitTest --tests "*TerminalPerformanceTest" --console=plain --info`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `medium`
- tdd_required: `false`

### P4-N7
- status: `conditional`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/data/MessageRepository.kt`
- action: keep repository paging/LRU deferred because `P4-N5` did not show OOM or unacceptable long-timeline growth
- why: the blueprint explicitly marks repository paging as conditional
- depends_on: `[P4-N5]`
- verify:
  - cmd: `cd android-app && ./gradlew :app:testDebugUnitTest --tests "*TerminalPerformanceTest" --console=plain --info`
  - pass_signal: `BUILD SUCCESSFUL`
- risk_level: `high`
- tdd_required: `false`

---

## Phase P5 - Session Sharing Layer

- Current State: `done-by-substitution`
- Already Closed:
  - `SessionGateway`
  - `DefaultSessionGateway`
  - `ChatViewModel` gateway consumption
- Completed In This Pass:

### P5-N6
- status: `done`
- target:
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
  - `refer/yuanio-mobile-phase-checklist-v2.1.1.md`
- action: record the architectural closure that retires `GlobalSessionManager` in favor of `SessionGateway`
- why: the repository already closes the sharing use case through `SessionGateway`; the missing piece was written architecture alignment
- depends_on: `[]`
- verify:
  - cmd: `rg -n "GlobalSessionManager|SessionGateway" "refer/yuanio-mobile-comprehensive-blueprint.md" "refer/yuanio-mobile-phase-checklist-v2.1.1.md"`
  - pass_signal: `documentation states the replacement path explicitly`
- risk_level: `low`
- tdd_required: `false`
- evidence:
  - `.ai/analysis/20260309-p5-session-decisions.md`

### P5-N7
- status: `done`
- target:
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
- action: close the `Hilt` decision gate as `keep-out` for the current architecture phase
- why: the codebase is stable with `YuanioApp` + `SessionGateway`; introducing DI would add churn without unlocking current requirements
- depends_on: `[P5-N6]`
- verify:
  - cmd: `rg -n "Hilt|@HiltAndroidApp|@AndroidEntryPoint|?? P0 ?? Hilt|?????? Hilt" "refer/yuanio-mobile-comprehensive-blueprint.md"`
  - pass_signal: `final Hilt decision is stated explicitly`
- risk_level: `low`
- tdd_required: `false`

---

## Phase P6 - Terminal / Visual Enhancement Layer

- Current State: `done`
- Completed In This Pass:

### P6-N4
- status: `done`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatTopBar.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt`
  - `android-app/app/src/main/java/com/yuanio/app/service/TerminalForegroundService.kt`
- action: finish the action-icon convergence so chat/terminal surfaces no longer mix `ic_ms_*` with Tabler action glyphs
- why: the blueprint visual system had migrated core surfaces, but targeted chat/terminal surfaces still carried residual Material icons
- depends_on: `[]`
- verify:
  - cmd: `rg -n "ic_ms_" "android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatTopBar.kt" "android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt" "android-app/app/src/main/java/com/yuanio/app/service/TerminalForegroundService.kt"`
  - pass_signal: `0 matches in the targeted files`
- risk_level: `medium`
- tdd_required: `false`

### P6-N5
- status: `done`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatTopBar.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`
- action: remove forced tinting from brand icons, switch `BrandIcon` to intrinsic-color rendering, and embed brand colors in drawable resources where needed
- why: the blueprint requires brand icons to preserve original color while action glyphs remain monochrome/tintable
- depends_on: `[]`
- verify:
  - cmd: `rg -n "tint = tint|tint = brandColor|tint = agentColor" "android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt" "android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatTopBar.kt" "android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt"`
  - pass_signal: `Brand icons no longer rely on forced tint`
- risk_level: `medium`
- tdd_required: `true`
- evidence:
  - `android-app/app/src/test/java/com/yuanio/app/ui/component/BrandIconsTest.kt`
  - `.ai/analysis/20260309-p6-visual-polish.md`

### P6-N6
- status: `done`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt`
- action: add the blueprint-specified message enter animation (`fadeIn + slideInVertically`) while preserving the current performance baseline
- why: the list already had `animateContentSize`, but the higher-order interaction polish was still missing
- depends_on: `[P4-N5]`
- verify:
  - cmd: `rg -n "slideInVertically|fadeIn" "android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt"`
  - pass_signal: `animation API is present`
- risk_level: `low`
- tdd_required: `false`

## Recommended Execution Order

1. `P0-N5` -> `P0-N6` -> `P0-N7`
2. `P1-N6`
3. `P2-N6`
4. `P3-N6`
5. `P4-N5` -> conditionally `P4-N6` / `P4-N7`
6. `P5-N6` -> `P5-N7`
7. `P6-N4` -> `P6-N5` -> `P6-N6`

## Exit Criteria

- All `gap` nodes are either implemented or explicitly downgraded to `conditional` / `decision` with evidence.
- `refer/yuanio-mobile-comprehensive-blueprint.md` and this checklist no longer disagree on phase closure.
- No residual `ic_ms_*` remains in the targeted P6 surfaces.
- Parser contract is fully typed and regression-locked for both chat events and state/control events.

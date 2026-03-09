# Yuanio Mobile Comprehensive Blueprint

> **Version**: `2.1.1`
> **Updated**: `2026-03-09`
> **Scope**: cross-stack `packages/shared/` + `packages/cli/` + `android-app/`
> **Encoding Note**: `UTF-8 normalized on 2026-03-09`
> **Companion Docs**:
> - `refer/yuanio-mobile-decision-matrix.md`
> - `refer/yuanio-mobile-phase-checklist-v2.1.1.md`
> - `refer/yuanio-mobile-phase-backfill-checklist-v2.1.1.md`

---

## 0. Positioning

### 0.1 Core Product Position

Yuanio Mobile is **not** a standalone Android rewrite of the desktop agent runtime.
It is a **remote UI surface** for an already-authoritative local session.

The architectural direction in `v2.1.x` is:

- protocol-first
- Android phased convergence
- evidence-driven optimization
- no speculative framework migration

### 0.2 Authority Boundary

- Desktop / CLI session is the source of truth.
- `packages/shared/` defines protocol truth.
- `packages/cli/src/remote/dispatch.ts` defines event-to-message dispatch truth.
- Android consumes the shared contract and must not invent protocol fields unilaterally.

### 0.3 Keep-Out Boundary

The following items remain outside the current implementation scope unless their explicit decision gate is reopened with evidence:

- `Hilt`
- `GlobalSessionManager`
- `StreamingMarkdown`
- `MessageRepository` paging / LRU layer

---

## 1. Current State Audit

As of `2026-03-09`, the repository already closes most of the original large-scope blueprint intent.

### 1.1 Already Implemented

- Contract-layer parser convergence around `AgentEventParser`
- Shared chat domain model with stable message identity
- Four-state tool-call contract on Android
- Typed approval UI with diff preview path
- Auto-reject kept default-off and risk-tiered
- Input-layer convergence around `ChatInputBar`
- Session sharing through `SessionGateway` / `DefaultSessionGateway`
- Terminal and targeted visual improvements
- Tabler icon convergence for Android action glyphs
- Performance baseline + Compose metrics capture

### 1.2 Still Deferred by Design

- `StreamingMarkdown`
- `MessageRepository` paging / LRU

These are **not missing features by default**.
They are intentionally deferred until their decision gates are reopened by evidence.

---

## 2. Protocol Gap Analysis

### 2.1 Truth Sources

- Shared protocol types: `packages/shared/src/types.ts`
- Shared schemas: `packages/shared/src/schemas.ts`
- CLI dispatch truth: `packages/cli/src/remote/dispatch.ts`
- Android consumer: `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`

### 2.2 Alignment Summary

| Concern | Shared / CLI Truth | Android Handling | Decision |
|---|---|---|---|
| chat text | shared payload + dispatch mapping | parsed to `ChatItem` and stream state | aligned |
| thinking | adapter -> dispatch -> Android parser | rendered as thinking updates | aligned |
| tool call | CLI emits running / done / error | Android keeps 4-state UI contract | aligned |
| approval | CLI emits approval payloads | Android renders typed approval cards | aligned |
| file diff | dispatch emits diff events | Android routes to diff-capable UI path | aligned |
| usage / status | CLI emits cumulative status signals | Android consumes as informational state | aligned |
| heartbeat / interaction state | Android still handles runtime-support envelopes | allowed Android superset | retained |

### 2.3 Rule

Android may support a runtime superset for local UI state, but may not redefine the shared remote protocol contract.

---

## 3. Test Fixture Strategy

### 3.1 Fixture Families

The parser and UI contract should continue to validate at least these fixture families:

- Claude
- Codex
- Gemini

### 3.2 Required Event Shapes

| Family | Required examples |
|---|---|
| Claude | thinking, tool call running, tool call success, approval, file diff, stream chunk, usage |
| Codex | thinking, exec approval, tool call / result, status |
| Gemini | thinking, tool call, stream chunk, usage |
| Robustness | unknown event type, malformed payload, missing optional fields |

### 3.3 Parser Requirement

Unknown or malformed events must fail gracefully and must not crash Android parsing.

---

## 4. Phase Plan

This blueprint keeps the implementation sequence from `P0` to `P6`, but narrows each phase to the smallest evidence-backed target.

| Phase | Goal | Current State | Exit Gate |
|---|---|---|---|
| `P0` Contract layer | parser convergence and protocol normalization | completed | `AgentEventParserTest` + `assembleDebug` |
| `P1` Chat model layer | stable list identity and render baseline | completed | `assembleDebug` + list behavior remains stable |
| `P2` Input layer | `ChatInputBar` convergence | completed | targeted input behavior remains stable |
| `P3` Approval layer | typed cards, diff viewer, risk-tiered auto-reject | completed | approval tests + manual sanity |
| `P4` Performance layer | metrics-first optimization, no premature complexity | completed | Compose metrics present + `TerminalPerformanceTest` passes |
| `P5` Session sharing layer | gateway-based shared session model | completed | session gateway tests + app-scoped gateway |
| `P6` Terminal / visual layer | targeted Android visual closure | completed | icon / chat list / terminal checks pass |

### 4.1 P0 - Contract Layer

Scope:
- `AgentEventParser`
- `ChatItem`
- `ChatViewModel` parser routing

Constraint:
- keep protocol truth upstream in shared / CLI layers

### 4.2 P1 - Chat Model Layer

Scope:
- stable keys
- `contentType`
- isolated streaming row
- `remember(content)` style caching where justified

Constraint:
- do not introduce `StreamingMarkdown` at this phase

### 4.3 P2 - Input Layer

Scope:
- state convergence
- slash command / template / upload / voice entry continuity

Constraint:
- do not refactor input state into an unrelated architecture layer without evidence

### 4.4 P3 - Approval Layer

Scope:
- approval typing
- diff preview path
- default-off auto-reject with risk tiers

Constraint:
- approval product decision is stability-first, not maximum automation-first

### 4.5 P4 - Performance Layer

Scope:
- Compose metrics capture
- terminal performance regression gate
- evidence-only reopening of expensive optimizations

Constraint:
- `StreamingMarkdown` and `MessageRepository` stay deferred unless the re-entry gates are approved

### 4.6 P5 - Session Sharing Layer

Scope:
- `SessionGateway`
- `DefaultSessionGateway`
- app-scoped shared gateway instance
- `ChatViewModel` consumes the gateway instead of creating its own local session transport

Constraint:
- no `GlobalSessionManager`
- no `Hilt`

### 4.7 P6 - Terminal / Visual Layer

Scope:
- targeted visual polish
- Tabler icon convergence
- terminal / chat surface refinement

Constraint:
- keep rollback easy and avoid broad visual redesign

---

## 5. Key Decisions

### 5.1 Tool Call Status

Android keeps a four-state tool-call contract:

- `RUNNING`
- `SUCCESS`
- `ERROR`
- `AWAITING_APPROVAL`

Rationale:
- this matches what the current cross-stack contract actually needs
- Android should not invent a seven-state contract ahead of shared protocol evolution

### 5.2 Auto-Reject

Auto-reject remains:

- default off
- risk-tiered when enabled

Rationale:
- Yuanio is a remote-control surface for an already-running session
- the default should favor continuity and visibility, not silent interruption

### 5.3 Feature Preferences

`FeaturePrefs` continues to reuse the existing project preference pattern.
No new DSL or dependency-injection framework is introduced for this concern.

### 5.4 Session Sharing

The session-sharing decision is closed in favor of:

- `SessionGateway`
- `DefaultSessionGateway`
- `YuanioApp.sessionGateway`

This retires the need for `GlobalSessionManager` in the current phase plan.

### 5.5 Deferred Complexity

The following remain evidence-gated:

- `StreamingMarkdown`
- `MessageRepository`

Their reopening rules are maintained in:
- `refer/yuanio-mobile-deferred-reentry-gates.md`

---

## 6. Verification Commands

### 6.1 Android Guard Suite

- `bun run check:android-guards`
- `bun run check:android-architecture`
- `bun run check:android-deferred-gates`

### 6.2 Build / Lint / Test

- `cd android-app && ./gradlew assembleDebug --console=plain`
- `cd android-app && ./gradlew lintDebug --console=plain`
- `cd android-app && ./gradlew :app:compileDebugAndroidTestKotlin --console=plain`
- `cd android-app && ./gradlew :app:testDebugUnitTest --tests "*BrandIconsTest" --tests "*ApprovalCardTest" --tests "*ChatMessageListBehaviorTest" --tests "*TerminalPerformanceTest" --console=plain`
- `cd android-app && ./gradlew :app:testDebugUnitTest --tests "*SessionGateway*" --console=plain`

### 6.3 Asset Guard

- `python tools/check_tabler_icons.py`
- `bun run check:tabler-icons`

---

## 7. Critical File Paths

### 7.1 Shared Protocol

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/cli/src/remote/dispatch.ts`

### 7.2 Android Core

- `android-app/app/src/main/java/com/yuanio/app/data/AgentEventParser.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- `android-app/app/src/main/java/com/yuanio/app/data/SessionGateway.kt`
- `android-app/app/src/main/java/com/yuanio/app/data/DefaultSessionGateway.kt`
- `android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt`

### 7.3 Execution Companions

- `refer/yuanio-mobile-decision-matrix.md`
- `refer/yuanio-mobile-phase-checklist-v2.1.1.md`
- `refer/yuanio-mobile-phase-backfill-checklist-v2.1.1.md`
- `refer/yuanio-mobile-deferred-reentry-gates.md`

---

## Appendix A - ADR Summary

### ADR-1

Do not turn `P0` into a broad Android architecture rewrite.
Keep it protocol-first and parser-first.

### ADR-2

Keep the Android tool-call UI contract at four states until shared protocol truth changes.

### ADR-3

Keep auto-reject default off; when enabled, use risk-tiered behavior.

### ADR-4

Keep `StreamingMarkdown` and `MessageRepository` deferred until evidence reopens them.

### ADR-5

Use repository-root-relative paths across blueprint, matrix, and checklist documents.

---

## Appendix B - Operational Rule

If a future change conflicts with this blueprint, update documents in this order:

1. `refer/yuanio-mobile-decision-matrix.md`
2. `refer/yuanio-mobile-comprehensive-blueprint.md`
3. phase checklist / backfill checklist
4. guard scripts and CI if the decision requires enforcement

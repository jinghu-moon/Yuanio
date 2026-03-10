# Yuanio Mobile v2.1.1 Executable Phase Checklist

- Source of Truth: `refer/yuanio-mobile-comprehensive-blueprint.md`
- Blueprint Version: `v2.1.1`
- Checklist Status: `P6-complete`
- Encoding Note: `ASCII-first markdown to avoid Windows heredoc/codepage corruption`

## Scope Gate

**In Scope**
- Android protocol convergence and UI-layer follow-up within the existing shared protocol boundary.
- Phase-based execution from `P0` to `P6` with explicit entry/exit gates.
- UI enhancement in `P6` only when gated behind a feature flag or quick rollback path.

**Out of Scope**
- Introducing `Hilt` before a dedicated evaluation phase.
- Adding new protocol fields on Android without updating `packages/shared/` and CLI dispatch first.
- Entering `P6` before `P5` exit gate passes.

## Global Rules
- Execute one phase at a time.
- Run each node's `verify.cmd` before marking it complete.
- Stop phase advancement on any failed `exit_gate`.
- Keep protocol truth in `packages/shared/` and `packages/cli/src/remote/dispatch.ts`.
- Keep high-risk UI changes behind a feature flag or quick rollback.

## Phase Overview
- [x] `P0` Contract layer: parser convergence.
- [x] `P1` Chat model layer: stable list and render baseline.
- [x] `P2` Input layer: `ChatInputBar` convergence.
- [x] `P3` Approval layer: typed cards, diff viewer, auto-reject.
- [x] `P4` Performance layer: metrics-driven optimization.
- [x] `P5` Session sharing layer: gateway and shared state.
- [x] `P6` Terminal / visual enhancement layer.

---

## Phase P0 - Contract Layer
- status: `completed`
- summary:
  - Extracted `ChatItem` domain model.
  - Added `AgentEventParser` pure parser.
  - Extended fixture-first parser coverage.
  - Routed `ChatViewModel.handleEnvelope()` through parser.
- key_targets:
  - `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/AgentEventParser.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- verification:
  - `cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest" --console=plain`
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P1 - Chat Model Layer
- status: `completed`
- summary:
  - Stabilized `ChatMessageList` item keys and `contentType`.
  - Kept streaming rendering isolated.
  - Preserved Compose-friendly stable chat domain types.
- key_targets:
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`
- verification:
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P2 - Input Layer
- status: `completed`
- summary:
  - Converged `ChatInputBar` state and actions.
  - Kept markdown, voice, template, upload, and quick action flows aligned.
- key_targets:
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatInputBar.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatScreen.kt`
- verification:
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P3 - Approval Layer
- status: `completed`
- summary:
  - Typed `ApprovalCard` rendering by approval type.
  - Added `DiffViewer` path.
  - Added auto-reject policy behind `FeaturePrefs`.
- key_targets:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/DiffViewer.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/FeaturePrefs.kt`
- verification:
  - `cd android-app && ./gradlew testDebugUnitTest --tests "*ApprovalCard*" --tests "*DiffViewer*" --tests "*AutoReject*" --console=plain`
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P4 - Performance Layer
- status: `completed`
- summary:
  - Captured compose metrics baseline; approved lightweight `StreamingMarkdown` sanitizer via K03 evidence; `MessageRepository` remains deferred.
  - Improved chat auto-scroll and search debounce.
  - Heavy renderer/LRU work remains deferred because metrics baseline is already acceptable.
- key_targets:
  - `android-app/app/build.gradle.kts`
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- verification:
  - `cd android-app && ./gradlew testDebugUnitTest --tests "*ChatMessageList*" --tests "*SearchQueryDebounce*" --console=plain`
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P5 - Session Sharing Layer
- status: `completed`
- entry_condition:
  - [x] `P4` exit gate passed.
- architecture_closure:
  - `GlobalSessionManager` is retired in favor of `SessionGateway` / `DefaultSessionGateway`.
  - `Hilt` remains keep-out for the current architecture stage.
- nodes:
  - [x] `P5-N1` Define `SessionGateway` contract.
  - [x] `P5-N2` Implement `DefaultSessionGateway`.
  - [x] `P5-N3` Move `ChatViewModel` to gateway consumption.
- key_targets:
  - `android-app/app/src/main/java/com/yuanio/app/data/SessionGateway.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/DefaultSessionGateway.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
  - `android-app/app/src/test/java/com/yuanio/app/data/DefaultSessionGatewayTest.kt`
- verification:
  - `cd android-app && ./gradlew testDebugUnitTest --tests "*SessionGateway*" --console=plain`
  - `cd android-app && ./gradlew assembleDebug --console=plain`

## Phase P6 - Terminal / Visual Enhancement Layer
- status: `completed`
- entry_condition:
  - [x] `P5` exit gate passed.
- exit_gate:
  - `cd android-app && ./gradlew assembleDebug --console=plain`
- rollback_boundary:
  - `revert_nodes: [P6-N1, P6-N2, P6-N3]`
  - `restore_point: P5 validated session-sharing baseline`

### P6-N1
- status: `[x]`
- title: `SplitPane` and `MiniChatPane`
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/SplitPaneLayout.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/MiniChatPane.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatScreen.kt`
- result:
  - Added a landscape split-pane behind `FeaturePrefs.chatSplitPaneEnabled`.
  - Preserved the default single-pane experience.

### P6-N2
- status: `[x]`
- title: Icon system convergence
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/MainBottomBar.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/ThinkingBlock.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt`
  - `android-app/app/src/main/res/drawable/ic_tb_*.xml`
- result:
  - Added centralized `ActionGlyph` icon mapping for action UI.
  - Preserved brand icons and brand color handling.

### P6-N3
- status: `[x]`
- title: Message context menu and lightweight interactions
- target:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/MessageContextMenu.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/chat/MessageBubble.kt`
- result:
  - Extracted the long-press menu into `MessageContextMenu`.
  - Added lightweight `animateContentSize()` wrapping for chat items.

## Backfill Notes (2026-03-09)
- `P3`: `ApprovalCard` now dismisses with local `fadeOut + scaleOut(0.97f)` before approval callbacks fire.
- `P4`: `TerminalPerformanceTest --info` passed; `StreamingMarkdown` 仅启用轻量补全，`MessageRepository` 仍延后。
- `P6`: targeted chat/terminal surfaces no longer use `ic_ms_*`; brand icons render with intrinsic colors; `ChatMessageList` adds `fadeIn + slideInVertically`.

## Verification Record
- phase: `P6`
- verified_at: `2026-03-08`
- fresh_evidence:
  - `cd android-app && ./gradlew assembleDebug --console=plain`
- implementation_notes:
  - Added UTF-8-safe checklist normalization.
  - Repaired question-mark placeholder string resources that broke resource linking.
  - Kept `P6` risky UI changes behind a feature flag for quick rollback.

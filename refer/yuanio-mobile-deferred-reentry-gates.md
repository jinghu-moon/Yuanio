# Yuanio Mobile 延后方案重开准入门

- Source of Truth: `refer/yuanio-mobile-decision-matrix.md`
- Purpose: 把 `K03` / `K04` 的“何时允许重开”固化成可执行准入标准，避免凭感觉引入复杂层。

## K03 `StreamingMarkdown`

- 默认状态：`deferred`
- 允许重开前提：
  - 必须先出现真实流式 Markdown 渲染退化证据，而不是“理论上可能更快”。
  - 必须有新鲜 Compose Metrics 产物。
  - 必须证明现有 `TerminalPerformanceTest` 基线没有先失守。
- 若主代码出现 `StreamingMarkdown`，则必须同时提供：
  - `.ai/analysis/k03-streaming-markdown-reentry.json`
- 证据文件最小字段：
  - `decision = "approved"`
  - `reason`
  - `composeMetricsFresh = true`
  - `streamingJankObserved = true`
  - `terminalPerfRetained = true`
  - `verificationCommands = [...]`

## K04 `MessageRepository` / LRU / 分页

- 默认状态：`deferred`
- 允许重开前提：
  - 必须先出现 OOM、长时间线退化，或 `1000+` 消息场景下可复现的内存 / 滚动问题。
  - 必须证明问题已超出当前 `ChatMessageList` + 现有状态管理可承受范围。
- 若主代码出现 `MessageRepository` / `LazyPagingItems` / `paging3`，则必须同时提供：
  - `.ai/analysis/k04-message-repository-reentry.json`
- 证据文件最小字段：
  - `decision = "approved"`
  - `reason`
  - `oomObserved` 或 `longTimelineRegressionObserved` 至少一个为 `true`
  - `memoryOrTimelineEvidence`
  - `chatListBehaviorRetained = true`
  - `verificationCommands = [...]`

## 守卫命令

- `python tools/check_android_deferred_reentry.py`
- `bun run check:android-deferred-gates`
- `bun run check:android-guards`

## CI 期望

- `android-verify` job 必须运行 Android 守卫总入口。
- 守卫通过仅表示“当前没有越过延后边界”或“越过边界时证据齐全”，不代表要立即实现对应方案。

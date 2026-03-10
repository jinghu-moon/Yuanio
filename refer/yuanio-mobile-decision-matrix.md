# Yuanio Mobile 蓝图决策落实矩阵

- Source of Truth: `refer/yuanio-mobile-comprehensive-blueprint.md`
- Snapshot: `2026-03-09`
- Purpose: 把“已经决策并落地”“继续延后”“现在还能继续固化”的事项拆开，避免反复重开大重构。

## 状态说明

- `implemented`: 决策已经落地到代码与文档。
- `operationalized`: 决策本身已成立，本轮继续把守护措施补齐。
- `deferred`: 蓝图明确允许延后，且当前证据支持继续延后。
- `keep-out`: 当前阶段明确不应引入。

## A. 已决策且已落地

| ID | 决策 | 蓝图来源 | 当前状态 | 代码 / 证据落点 | 当前策略 |
|---|---|---|---|---|---|
| D01 | `P0` 收紧为“协议先行 + `ChatViewModel` 接入”，不在 `P0` 扩散复杂度 | `ADR-1`, `§0`, `§3.4` | `implemented` | `android-app/app/src/main/java/com/yuanio/app/data/AgentEventParser.kt`, `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`, `refer/yuanio-mobile-phase-backfill-checklist-v2.1.1.md` | 保持 `P0` 只做契约层收敛 |
| D02 | `ToolCallStatus` 保留 4 态，而不是 7 态 | `ADR-2`, `§6.3` | `implemented` | `android-app/app/src/main/java/com/yuanio/app/ui/model/ChatItem.kt`, `android-app/app/src/main/java/com/yuanio/app/ui/component/ToolCallCard.kt`, `android-app/app/src/test/java/com/yuanio/app/data/AgentEventParserTest.kt` | Android 继续跟随共享协议，不自行发明额外状态 |
| D03 | `Auto-Reject` 默认关闭，开启后按风险等级分级 | `ADR-3`, `P3` | `implemented` | `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt`, `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`, `android-app/app/src/test/java/com/yuanio/app/ui/component/ApprovalCardTest.kt` | 不改变默认关闭的产品决策 |
| D04 | 会话共享层走 `SessionGateway` / `DefaultSessionGateway`，不重启 `GlobalSessionManager` | `§3.3`, `P5` | `implemented` | `android-app/app/src/main/java/com/yuanio/app/data/SessionGateway.kt`, `android-app/app/src/main/java/com/yuanio/app/data/DefaultSessionGateway.kt`, `android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt`, `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`, `.ai/analysis/20260309-d04-session-gateway-audit.md` | 已收敛到应用级共享实例，后续只做边界审计与防回退测试 |
| D05 | 文档与任务清单统一使用仓库根相对路径 | `ADR-5` | `implemented` | `refer/yuanio-mobile-comprehensive-blueprint.md`, `refer/yuanio-mobile-phase-checklist-v2.1.1.md`, `refer/yuanio-mobile-phase-backfill-checklist-v2.1.1.md` | 继续保持 repo-relative 书写 |
| D06 | Android UI 操作图标统一切到 Tabler，品牌图标保留自身颜色 | `§2.2` | `implemented` | `android-app/app/src/main/res/drawable/ic_tb_*.xml`, `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt`, `docs/android-icons.md` | 新增 UI glyph 一律优先 Tabler |

## B. 当前应继续延后 / keep-out 的事项

| ID | 决策 | 蓝图来源 | 当前状态 | 继续策略 | 原因 |
|---|---|---|---|---|---|
| K01 | 现阶段不引入 `Hilt` | `ADR-1`, `P5` | `keep-out` | 继续禁止在 `android-app` 引入 `@HiltAndroidApp` / `@AndroidEntryPoint` | 目前没有必须用 Hilt 才能解决的结构问题 |
| K02 | 不重建 `GlobalSessionManager` | `§3.3`, `P5` | `keep-out` | 继续沿用 `SessionGateway` 路线 | 当前替代方案已满足跨 Screen 会话共享 |
| K03 | `StreamingMarkdown` 按证据重开（轻量补全） | `ADR-4`, `P4` | `implemented` | 以轻量补全处理未闭合标签，复杂渲染需新证据 | 用户反馈流式 Markdown 闪烁，准入证据见 `.ai/analysis/k03-streaming-markdown-reentry.json` |
| K04 | `MessageRepository` LRU / 分页保持条件延后 | `ADR-4`, `P4` | `deferred` | 仅在 OOM / 长时间线退化出现后重开 | 当前没有内存与长列表异常证据 |

## C. 现在值得继续做的固化项

| ID | 动作 | 状态 | 本轮执行结果 | 输出 |
|---|---|---|---|---|
| O01 | 补一份“蓝图决策 -> 当前状态 -> 代码落点”的矩阵文档 | `operationalized` | 已完成 | `refer/yuanio-mobile-decision-matrix.md` |
| O02 | 清理历史文档中的旧图标命名与图标规范陈述 | `operationalized` | 已执行 | `docs/android-icons.md`, `docs/6.md`, `refer/yuanio-mobile-comprehensive-blueprint.md` |
| O03 | 把 Android 验证门固化进 GitHub CI | `operationalized` | 已执行 | `.github/workflows/ci.yml` |
| O04 | 补 D04 的应用级共享实例审计与防回退测试 | `operationalized` | 已执行 | `android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt`, `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`, `android-app/app/src/test/java/com/yuanio/app/ui/screen/ChatViewModelSessionGatewayTest.kt`, `.ai/analysis/20260309-d04-session-gateway-audit.md` |
| O05 | 增加 Android 架构守卫，阻止 `Hilt` / `GlobalSessionManager` / 非应用级 `DefaultSessionGateway` 回流 | `operationalized` | 已执行 | `tools/check_android_architecture.py`, `.github/workflows/ci.yml`, `package.json` |
| O06 | 为 `K03` / `K04` 增加延后方案重开准入门，防止无证据引入 `StreamingMarkdown` / `MessageRepository` | `operationalized` | 已执行 | `tools/check_android_deferred_reentry.py`, `refer/yuanio-mobile-deferred-reentry-gates.md`, `.github/workflows/ci.yml`, `package.json` |
| O07 | 聚合 Android 决策守卫入口，统一本地与 CI 的调用方式 | `operationalized` | 已执行 | `tools/check_android_guards.py`, `.github/workflows/ci.yml`, `package.json` |

## 使用原则

- 没有新证据，不重开 `Hilt` / `GlobalSessionManager` / `MessageRepository`；`StreamingMarkdown` 已按证据启用轻量补全，进一步扩展仍需新证据。
- 新的 Android 行为改动，先补验证，再宣称“完成”。
- 每次触及 Android 架构边界后，运行 `bun run check:android-guards`。
- 每次尝试引入 `StreamingMarkdown` / `MessageRepository` 前，先运行 `bun run check:android-deferred-gates` 并补齐证据文件。
- 任何后续阶段规划，都应先更新本矩阵，再更新蓝图或 checklist。

# Diff 面板落地记录（Round 1）

日期：2026-03-04

## 目标
- 增加用户可感知的“代码变更处理”能力：在手机端与 Web 端直接对 `file_diff` 执行 `accept/rollback`。
- 按“底层到消费层”打通协议：消息发送、结果回传、UI 状态更新。

## 本轮实现（底层到消费层）

### 1) 协议与执行层
- 新增/使用消息类型：
  - `file_diff`：桌面 agent 输出文件变更
  - `diff_action`：移动端/Web 下发变更动作
  - `diff_action_result`：桌面端执行结果回传
- 执行逻辑：
  - `accept`：no-op（保留当前改动）
  - `rollback`：执行 `git checkout -- <path>`

关键文件：
- `packages/cli/src/remote/diff-action.ts`
- `packages/cli/src/remote.ts`
- `packages/cli/src/remote/dispatch.ts`

### 2) Android 消费层
- 新增 `DiffPanel` 组件，聚合最近变更并提供“接受 / 回滚”按钮。
- `ChatScreen` 接入 diff 面板，按路径去重、最近优先。
- `ChatViewModel`：
  - 处理 `file_diff` 入流；
  - 发送 `diff_action`；
  - 处理 `diff_action_result` 成功后移除条目并 toast。

关键文件：
- `android-app/app/src/main/java/com/yuanio/app/ui/component/DiffPanel.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatScreen.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`

### 3) Web Dashboard 消费层
- 新增 “Diff 面板”。
- 实时维护 `recentDiffs` 列表。
- 支持发送 `diff_action` 并处理 `diff_action_result` 回执。

关键文件：
- `packages/web-dashboard/public/index.html`

## 验证结果（本地）

### 类型/编译
- `bun run typecheck`：通过
- `./gradlew.bat :app:compileDebugKotlin -q`：通过

### 单元测试
- `bun test packages/cli/src/remote/__tests__/diff-action.test.ts`：通过（1/1）

### 安装包
- `./gradlew.bat :app:assembleDebug`：通过
- 产物：`android-app/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk`

## 文档同步
- 协议文档已补充 `diff_action` / `diff_action_result`：
  - `docs/protocol.md`

## 参考源码可借鉴点（下一轮）
- `refer/agent-source-code/codex-main/codex-rs/tui/src/diff_render.rs`
  - 行号 gutter、主题自适配、按 hunk 渲染与换行处理。
- `refer/agent-source-code/gemini-cli-main/packages/cli/src/ui/components/messages/DiffRenderer.tsx`
  - 新文件内容渲染、hunk gap indicator、行号解析。
- `refer/agent-source-code/claude-code-main/docs/reference/interactive-mode.md`
  - `/diff` 交互导航（按文件/按轮次浏览）的产品交互形态。

## 已知限制
- `rollback` 依赖当前工作目录是 git 仓库且路径可解析；失败会通过 `diff_action_result.error` 返回。
- 当前面板为“文件级操作”，尚未到 hunk 级 accept/reject。

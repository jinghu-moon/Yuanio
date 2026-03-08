# Agent 增删改接口分析与调用方案（Round 1）

日期：2026-03-04

## 1. 目标
- 搞清楚 Claude/Codex/Gemini 的“文件改动”产出接口。
- 在 Yuanio 里统一抽象为 `file_diff`，让移动端/Web 端稳定消费。

## 2. 接口事实（基于源码）

### 2.1 Codex（原生文件变更事件）
- 协议层有 `ThreadItem::FileChange`，字段包含 `changes: Vec<FileUpdateChange>`，`diff` 在 `FileUpdateChange` 内。
- 参考：
  - `refer/agent-source-code/codex-main/codex-rs/app-server-protocol/src/protocol/v2.rs:3153`
  - `refer/agent-source-code/codex-main/codex-rs/app-server-protocol/src/protocol/v2.rs:3365`
- Yuanio 已有映射：
  - `packages/cli/src/adapters/codex-adapter.ts`（`item.completed(file_change)` -> `file_diff`）

### 2.2 Gemini（工具结果携带结构化 diff）
- 工具调用事件：`tool_call_request` / `tool_call_response`，带 `callId/name/args/resultDisplay`。
- 结果展示类型里有 `FileDiff` 结构（`fileDiff/filePath/newContent/originalContent/isNewFile`）。
- 参考：
  - `refer/agent-source-code/gemini-cli-main/packages/core/src/core/turn.ts:55`
  - `refer/agent-source-code/gemini-cli-main/packages/core/src/scheduler/types.ts:35`
  - `refer/agent-source-code/gemini-cli-main/packages/core/src/tools/tools.ts:700`

### 2.3 Claude（tool_use + tool_result，文件改动依赖工具参数/结果）
- `assistant.message.content` 有 `tool_use`，`result(subtype=tool_result)` 有 `tool_name/tool_use_id/content`。
- 工具名是 `Write/Edit/NotebookEdit` 等；`Edit/Write` 工具输出语义支持结构化 diff。
- 参考：
  - `refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:420`
  - `refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:537`

## 3. 统一调用方案（已实现）

### 3.1 统一提取器
- 新增 `packages/cli/src/adapters/file-change.ts`：
  - `fileDiffFromToolCall(tool, params)`：从 `tool_call` 参数构造预览 diff（意图级）。
  - `fileDiffFromToolResult(tool, result, fallback)`：优先解析结构化结果，失败回退到预览 diff。

### 3.2 Claude 适配策略
- 在 `tool_use` 阶段缓存 `toolUseId -> file_diff 预览`。
- 在 `tool_result` 阶段按 `tool_use_id` 产出最终 `file_diff`（只在成功路径发出）。
- 代码：
  - `packages/cli/src/adapters/claude-adapter.ts`

### 3.3 Gemini 适配策略
- 在 `tool_call_request` 阶段缓存 `callId -> file_diff 预览`。
- 在 `tool_call_response/tool_result` 阶段优先解析 `resultDisplay` 结构化 diff，回退缓存预览。
- 代码：
  - `packages/cli/src/adapters/gemini-adapter.ts`

### 3.4 Codex 适配策略
- 保持原生 `file_change -> file_diff` 映射，不做破坏性变更。

## 4. 验证结果

- 新增测试：
  - `packages/cli/src/adapters/__tests__/claude-adapter.test.ts`
    - `should emit file_diff after Edit tool_result using tool_use context`
  - `packages/cli/src/adapters/__tests__/gemini-adapter.test.ts`
    - `should emit file_diff from tool_call_response resultDisplay`
- 回归验证：
  - `bun run typecheck` 通过
  - `bun test packages/cli/src/adapters/__tests__/claude-adapter.test.ts` 通过
  - `bun test packages/cli/src/adapters/__tests__/gemini-adapter.test.ts` 通过
  - `bun test packages/cli/src/adapters/__tests__/dispatch.test.ts packages/cli/src/remote/__tests__/dispatch.test.ts` 通过

## 5. 当前边界
- Claude 在部分场景可能只返回简短 `tool_result` 文本（例如 `"ok"`），此时用的是参数推导 diff（预览级，不是真实补丁）。
- `rollback` 当前仍依赖 `git checkout -- <path>`，非 git 工作区无法回滚（已有 `diff_action_result.error` 回传）。

## 6. Round 2 真实联调结果（2026-03-04）

### 6.1 联调方法
- 脚本：`packages/cli/src/test-latency-agent-e2e.ts`
- 新增能力：
  - 支持 `--permission-mode`，联调时统一使用 `yolo`，避免审批阻塞。
  - 统计 `sendToFirstFileDiffMs`、`fileDiffCount`，并在 md/json 输出 `fileDiffSamples`。
  - 修复终端 ACK 卡死：`state=terminal` 时立即结束单轮，避免“测试一直卡着”。
- 统一 prompt（核心约束）：
  - 强制使用工具创建并二次修改同一文件，验证 `file_diff` 是否贯通。

### 6.2 结果汇总

| Agent | 结果 | 关键指标 | 说明 |
|---|---|---|---|
| Codex | 成功 | `fileDiffCount=2`，`sendToFirstFileDiffMs=15308.85` | 捕获到 `created + modified` 两条 `file_diff` |
| Claude | 受环境阻塞 | `fileDiffCount=0` | 本机 Claude CLI 未登录（`Not logged in · Please run /login`） |
| Gemini | 受环境阻塞 | `fileDiffCount=0` | 本机未安装 Gemini CLI（PATH 不存在 `gemini`） |

联调产物：
- `docs/latency-agent-e2e.codex.file-diff.round2.md`
- `docs/latency-agent-e2e.codex.file-diff.round2.json`
- `docs/latency-agent-e2e.claude.file-diff.round2.md`
- `docs/latency-agent-e2e.claude.file-diff.round2.json`
- `docs/latency-agent-e2e.gemini.file-diff.round2.md`
- `docs/latency-agent-e2e.gemini.file-diff.round2.json`

### 6.3 Codex 样本（真实消息）
- path:
  - `D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared.txt`
- actions:
  - `created`
  - `modified`
- 说明：
  - 本轮 Codex `file_change` 事件仅提供 `changes[path/kind]`，未带 `diff` 文本，故 `diffPreview` 为空字符串；消费层仍可稳定展示“文件级变更”与动作。

## 7. Round 3（Codex diff 补齐）

日期：2026-03-04

### 7.1 实现内容
- 文件：`packages/cli/src/adapters/codex-adapter.ts`
- 调整点：
  - `changes[]` 分支优先读取 `change.diff`（之前只读 `item.diff`）。
  - 当 `diff` 缺失时，基于本地快照构造 fallback unified diff：
    - `created`: `"" -> 当前文件内容`
    - `modified`: `缓存旧内容 -> 当前文件内容`（若无旧快照，标记 unavailable）
    - `deleted`: `缓存旧内容 -> ""`（若无旧快照，标记 unavailable）
  - 在 `turn.started/turn.completed/turn.failed/error` 时清理快照缓存，避免跨轮污染。

### 7.2 参考依据（源码）
- Codex 协议 `FileUpdateChange` 包含 `diff` 字段：
  - `refer/agent-source-code/codex-main/codex-rs/app-server-protocol/src/protocol/v2.rs:3365`
- thread_history 转换时会填充 `diff`：
  - `refer/agent-source-code/codex-main/codex-rs/app-server-protocol/src/protocol/thread_history.rs:975`
  - `refer/agent-source-code/codex-main/codex-rs/app-server-protocol/src/protocol/thread_history.rs:1012`

### 7.3 验证
- 新增测试：
  - `packages/cli/src/adapters/__tests__/codex-adapter.test.ts`
    - `should prefer change.diff when official changes[] includes per-change diff`
    - `should build fallback diff from local snapshot when change.diff is missing`
- 通过：
  - `bun run typecheck`
  - `bun test packages/cli/src/adapters/__tests__/codex-adapter.test.ts`
  - `bun test packages/cli/src/adapters/__tests__/dispatch.test.ts packages/cli/src/remote/__tests__/dispatch.test.ts`

### 7.4 真实联调结果（Codex）
- 产物：
  - `docs/latency-agent-e2e.codex.file-diff.round3.md`
  - `docs/latency-agent-e2e.codex.file-diff.round3.json`
- 关键点：
  - `fileDiffCount = 1`
  - `sendToFirstFileDiffMs = 15008.04`
  - `fileDiffSamples[0].diffPreview` 已为非空（包含 `+alpha` / `+beta`）

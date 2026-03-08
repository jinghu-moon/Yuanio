# 用户可感知优化：首包前临时 Thinking 心跳

生成时间：2026-03-03

## 目标

- 在模型首 chunk 仍较慢时，先让手机端看到「正在响应」的可视反馈。
- 不污染最终 AI 正文，不把临时提示写入历史消息。

## 实现

### 1) 协议扩展（兼容）

文件：`packages/shared/src/types.ts`

`ThinkingPayload` 新增可选字段：

- `ephemeral?: boolean`
- `done?: boolean`
- `phase?: string`
- `elapsedMs?: number`

### 2) Agent 侧（CLI）首包前心跳

文件：`packages/cli/src/remote/prompt.ts`

- 新增首包前 thinking 机制（默认开启）：
  - 定时发送 `MessageType.THINKING`，内容如 `等待 codex 首包中...`
  - 标记 `ephemeral: true`，`phase: "pre_output"`
- 在以下时机发送 `done: true` 并停止：
  - 收到首个上游输出
  - 任务成功结束
  - 任务异常结束

可调环境变量：

- `YUANIO_PRE_OUTPUT_THINKING=0|1`（默认 1）
- `YUANIO_PRE_OUTPUT_THINKING_INTERVAL_MS`（默认 1200）
- `YUANIO_PRE_OUTPUT_THINKING_MAX_TICKS`（默认 15）

### 3) Android 消费层（不留脏数据）

文件：`android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`

- `ChatItem.Thinking` 新增 `ephemeral: Boolean`
- 消费 `thinking` 时：
  - `ephemeral=true && done=true`：移除对应临时 thinking
  - 否则按 `turnId` 更新/创建临时 thinking
- 在 `stream_chunk` 首次进入与 `stream_end` 收尾时，兜底清理所有 `ephemeral thinking`

## 验证

### 类型与测试

- `bun run typecheck`：通过
- `bun test src/remote/__tests__/dispatch.test.ts src/remote/__tests__/stream-replay.test.ts`：通过
- `./gradlew :app:compileDebugKotlin`：通过

### 端到端快测（codex, warmup=0, iterations=1）

报告文件：

- `docs/latency-agent-e2e.user-visible.md`
- `docs/latency-agent-e2e.user-visible.json`

关键指标：

- `sendToAckWorkingMs`: 2.06ms
- `sendToFirstThinkingMs`: 16.89ms
- `sendToFirstChunkMs`: 13528.82ms
- `thinkingCount`: 3

结论：

- 用户可在首包前 ~17ms 收到可见 thinking 反馈。
- 模型首 chunk 本身仍在秒级，体感通过临时 thinking 明显改善。

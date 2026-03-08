# Chat 流式渲染端到端验收清单

## 1. 目标

1. 验证“终端链路”与“Android 对话界面”都按增量流式展示。
2. 验证 `stream_end` 收尾、状态事件过滤、异常兜底。

## 2. 前置条件

1. 本地已启动 relay 服务（默认 `http://localhost:3000`）。
2. Android App 已安装并完成配对。
3. CLI 代码已编译通过。

## 3. 终端可视化验证（必测）

运行：

```bash
bun run packages/cli/src/test-stream-visible.ts --server http://localhost:3000 --delay-ms 80 --prompt "流式测试"
```

预期：

1. 输出按 chunk 逐段出现，而不是一次性整块打印。
2. 能看到代码块逐步成形（示例中的 kotlin 代码）。
3. 最后出现 `STREAM_END` 收尾（脚本日志显示 `[e2e]  完成`）。

## 4. Adapter 回放验证（必测）

运行：

```bash
bun run --cwd packages/cli test:stream-replay
```

预期：

1. Claude/Codex/Gemini 三条回放都通过。
2. `status` 事件不会污染正文 chunk。
3. chunk 拼接后的文本与预期一致。

## 5. Android 界面验证（必测）

1. 在手机端发送 prompt，观察 AI 回复是否“逐步增长”。
2. 回复过程中输入框进入 `streaming` 状态，结束后恢复可发送。
3. 高频回复时滚动不明显卡顿，最后一条消息持续更新。
4. 错误场景（断网、agent 异常）能提示且不出现卡死。

## 6. 性能观察（建议）

1. 记录 `send_to_first_chunk` 延迟日志。
2. 长回复（>2k 字）观察是否出现大块突变。
3. 连续 10 次回复后，内存与滚动体验无明显恶化。

## 7. 故障判定

满足以下任一条即判定失败：

1. 仅在结束时一次性出现整段文本。
2. chunk 顺序错乱或重复拼接。
3. `status` 文本（如 `thread.started`）混入正文。
4. `stream_end` 后仍保持 streaming 态。

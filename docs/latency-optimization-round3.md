# 通信协议优化记录（Round 3）

- 时间: 2026-03-03
- 目标: 进一步降低流式链路尾延迟，同时保持恢复能力

## 本轮改动

1. Relay 对高频临时消息禁持久化（stream_chunk/thinking/heartbeat/status/terminal_output）
- 文件: `packages/relay-server/src/index.ts`
2. CLI 在 stream_end 携带 finalText（恢复兜底）
- 文件: `packages/cli/src/remote/prompt.ts`
3. Android 解析 stream_end.finalText，必要时覆盖 streamBuffer 保证完整输出
- 文件: `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`

## 编译验证

- `bun run typecheck` 通过
- `./android-app/gradlew.bat -p "android-app" :app:compileDebugKotlin` 通过

## 三版对比（快速口径）

- 基线: `docs/latency-baseline.json`
- Round2: `docs/latency-baseline.post-opt.json`
- Round3: `docs/latency-baseline.round3.json`

| 场景 | 指标 | P50 (基线→R2→R3) | P95 (基线→R2→R3) | Max (基线→R2→R3) |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.38 -> 0.47 -> 0.28 | 0.49 -> 0.83 -> 0.38 | 0.53 -> 2.45 -> 0.68 |
| text-small | sendToFirstChunkMs | 0.45 -> 0.58 -> 0.32 | 0.55 -> 0.87 -> 0.45 | 0.56 -> 2.52 -> 0.91 |
| text-large | sendToAckMs | 0.28 -> 0.46 -> 0.24 | 0.39 -> 0.62 -> 0.45 | 0.43 -> 0.63 -> 0.53 |
| text-large | sendToFirstChunkMs | 0.32 -> 0.63 -> 0.28 | 0.49 -> 0.80 -> 0.53 | 0.52 -> 0.81 -> 0.79 |
| binary-small | sendToEchoMs | 0.33 -> 0.60 -> 0.29 | 2.43 -> 10.79 -> 0.57 | 10.71 -> 12.54 -> 1.55 |
| binary-large | sendToEchoMs | 0.24 -> 0.54 -> 0.21 | 0.37 -> 0.73 -> 0.32 | 0.42 -> 0.84 -> 0.34 |

## 结论

- Round3 相对 Round2 对文本链路有所回收，但仍未全面优于初始基线。
- 当前快速基准噪声较大，建议在固定负载条件下跑完整口径（10/60）再决定是否保留全部策略。
- 稳定性改动（去重、分页恢复、分批 drain）建议保留；延迟策略可继续细化。

# 通信协议优化记录（Round 4）

- 时间: 2026-03-03
- 目标: 按“底层 -> 消费层”顺序，降低链路尾延迟并提升慢端稳定性

## 本轮改动

1. Relay 出站链路改为“按设备队列发送”，替代直接 `socket.to(room).emit`
- 文件: `crates/relay-server/src/index.ts`
- 新增:
  - 每设备出站队列（`message`/`ack`）
  - 瞬时消息优先丢弃（`stream_chunk/thinking/heartbeat/status/terminal_output/pty_*`）
  - 队列/字节硬阈值触发慢端断开
  - 基于 `event loop lag + ACK RTT` 的 AIMD 批量发送窗口

2. Relay ACK 语义与观测增强
- 文件: `crates/relay-server/src/index.ts`
- 新增:
  - ACK 状态规范化（`ok/working/retry_after/terminal`）
  - `retry_after` 不触发 `markDeliveryAcked`
  - ACK RTT 跟踪与过期清理
  - `/health` 增加 `ackRttMs` 与 `outboundQueue`

3. Android 消费层升级为结构化 ACK
- 文件:
  - `android-app/app/src/main/java/com/yuanio/app/data/RelayAck.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/RelayClient.kt`
  - `android-app/app/src/main/java/com/yuanio/app/data/LocalRelayClient.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- 行为变化:
  - `working/ok`: 清理 pending，标记 Delivered
  - `retry_after`: 按 `retryAfterMs` 延迟重发（不清 pending）
  - `terminal`: 直接 fail pending

## 基准测试（本地文档）

- Markdown: `docs/latency-baseline.round4.md`
- JSON: `docs/latency-baseline.round4.json`
- 执行命令:
  - `bun run packages/cli/src/test-latency-baseline.ts --out docs/latency-baseline.round4.md --json-out docs/latency-baseline.round4.json`

## Round3(full) vs Round4（10/60 口径）

| 场景 | 指标 | P50 (R3 -> R4) | P95 (R3 -> R4) | Max (R3 -> R4) |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.38 -> 0.21 | 0.59 -> 0.31 | 12.46 -> 0.40 |
| text-small | sendToFirstChunkMs | 0.45 -> 0.24 | 0.71 -> 0.35 | 23.08 -> 0.43 |
| text-large | sendToAckMs | 0.44 -> 0.21 | 0.61 -> 0.41 | 28.96 -> 24.48 |
| text-large | sendToFirstChunkMs | 0.54 -> 0.27 | 1.30 -> 0.72 | 29.08 -> 24.70 |
| binary-small | sendToEchoMs | 0.44 -> 0.24 | 0.69 -> 0.90 | 18.63 -> 14.27 |
| binary-large | sendToEchoMs | 0.43 -> 0.19 | 0.59 -> 0.33 | 1.35 -> 10.33 |

## 验证

- `bun run typecheck` 通过
- `./android-app/gradlew.bat -p "android-app" :app:compileDebugKotlin` 通过
- `./android-app/gradlew.bat -p "android-app" :app:testDebugUnitTest --tests "com.yuanio.app.data.LocalRelayClientAuthTest"` 通过

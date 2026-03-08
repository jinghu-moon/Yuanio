# 通信协议优化记录（Round 10）

- 时间: 2026-03-03
- 目标: 继续降低链路尾延迟，按 3 次测试取中值评估

## 本轮实现（底层到消费层）

1. Relay 出站队列改造（按设备）
- 文件: `packages/relay-server/src/index.ts`
- 变更:
  - ACK 改为高优先级入队（不再使用无队列直发）
  - 保留 `pty_*` 直发，减少交互型二进制消息路径上的队列等待
  - 出站队列新增优先级插入策略（高优先级优先发送）
  - 高优先级包到来时，支持抢占已有延迟 flush 定时器
  - 慢端保护逻辑保持（瞬时消息丢弃 + 超限断开）

2. Relay 默认参数调优
- 文件: `packages/relay-server/src/index.ts`
- 变更:
  - `OUTBOUND_FLUSH_DELAY_MS` 默认 `8 -> 2`
  - `OUTBOUND_BASE_BATCH_SIZE` 默认 `24 -> 16`
  - `OUTBOUND_MAX_BATCH_SIZE` 默认 `128 -> 96`

3. Agent 输出侧优化（消费层上游）
- 文件: `packages/cli/src/remote/prompt.ts`
- 变更:
  - `stream_chunk` 自适应合并发送（smooth/catch-up 窗口）
  - `thinking` 节流发送（保留最后一次）
  - `stream_end` 前强制 flush，避免尾部文本丢失
  - 输出链路串行化，降低并发 dispatch 抖动

> 说明: 当前 `test-latency-baseline.ts` 是 relay/socket 基准（内置 agent/app stub），不会覆盖 `remote/prompt.ts` 的真实收益；该部分需在端到端用真实 agent 再测。

## 测试产物

- 原始:
  - `docs/latency-baseline.round10.run1.json`
  - `docs/latency-baseline.round10.run2.json`
  - `docs/latency-baseline.round10.run3.json`
- 中值聚合:
  - `docs/latency-baseline.round10.median.md`
  - `docs/latency-baseline.round10.median.json`

## 关键指标对比（Round6 中值 -> Round10 中值）

| 场景 | 指标 | P50 (R6 -> R10) | P95 (R6 -> R10) | Max (R6 -> R10) |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.23 -> 0.23 | 0.37 -> 0.33 | 0.52 -> 0.43 |
| text-small | sendToFirstChunkMs | 0.27 -> 0.25 | 0.44 -> 0.38 | 0.65 -> 0.61 |
| text-large | sendToAckMs | 0.21 -> 0.23 | 0.33 -> 0.44 | 8.01 -> 11.38 |
| text-large | sendToFirstChunkMs | 0.26 -> 0.28 | 0.75 -> 0.76 | 9.13 -> 14.70 |
| binary-small | sendToEchoMs | 0.23 -> 0.21 | 0.36 -> 0.78 | 20.12 -> 15.96 |
| binary-large | sendToEchoMs | 0.20 -> 0.20 | 0.48 -> 0.37 | 1.32 -> 7.48 |

## 结论

- 文本小包主干指标已改善（`text-small` 的 P95/Max 明显下降）。
- 文本大包与二进制链路仍有显著长尾波动，且 `max` 在不同 run 间漂移较大。
- 当前更像“测试噪声 + 调度抖动叠加”而非单一协议缺陷，下一步应先稳住评测环境再继续协议迭代。


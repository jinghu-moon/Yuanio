# 通信协议优化记录（Round 6）

- 时间: 2026-03-03
- 目标: 继续压尾延迟，并按要求执行 3 次测试取中值

## 本轮改动

1. ACK/PTY 改为彻底直发
- 文件: `packages/relay-server/src/index.ts`
- 变更:
  - `fastLane` 消息不再进入应用层出站队列，直接 `emit`
  - ACK 与 `pty_*` 继续使用 `fastLane`

2. drain 调度优化
- 文件: `packages/relay-server/src/index.ts`
- 变更:
  - 新增 `runSoon()`，优先 `setImmediate`（fallback `setTimeout(0)`）
  - 批量 drain 递归从 `setTimeout(0)` 切到 `runSoon()`，降低计时粒度抖动

## 三次测试（原始）

- `docs/latency-baseline.round6.run1.json`
- `docs/latency-baseline.round6.run2.json`
- `docs/latency-baseline.round6.run3.json`

## 三次取中值（聚合）

- Markdown: `docs/latency-baseline.round6.median.md`
- JSON: `docs/latency-baseline.round6.median.json`
- 聚合方式: 每个指标字段（`p50/p95/max/...`）按 3 次结果取中值

## 关键指标对比（Round5 -> Round6 中值）

| 场景 | 指标 | P50 (R5 -> R6m) | P95 (R5 -> R6m) | Max (R5 -> R6m) |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.19 -> 0.23 | 0.32 -> 0.37 | 0.39 -> 0.52 |
| text-small | sendToFirstChunkMs | 0.22 -> 0.27 | 0.35 -> 0.44 | 0.41 -> 0.65 |
| text-large | sendToAckMs | 0.18 -> 0.21 | 0.29 -> 0.33 | 0.42 -> 8.01 |
| binary-large | sendToEchoMs | 0.19 -> 0.20 | 0.36 -> 0.48 | 7.51 -> 1.32 |
| binary-small | sendToEchoMs | 0.21 -> 0.23 | 0.57 -> 0.36 | 25.55 -> 20.12 |

## 结论

- 二进制链路尾部极值有改善（尤其 `binary-large max`）。
- 文本链路在三次中值口径下出现回退，说明当前“直发 + 立即调度”策略仍会引入场景相关抖动。
- 建议下一轮将 `fastLane` 从“无队列直发”回调为“独立高优先级队列 + 固定顺序 flush”，避免跨类型消息竞争造成 jitter。

# 通信协议优化记录（Round 5）

- 时间: 2026-03-03
- 目标: 针对 Round4 的尾延迟回归，给 ACK/PTY 建立低延迟快车道

## 本轮改动

1. ACK + PTY 快车道
- 文件: `crates/relay-server/src/index.ts`
- 改动:
  - 新增 `fastLane` 出站标记
  - 当目标设备队列为空时，`ACK/PTY` 直接发送（绕过 flush delay）
  - 即使入队，`ACK/PTY` 也触发立即 flush（0ms）
- 设计意图:
  - 在保留现有队列/背压/慢端保护的前提下，消除关键控制包的额外等待

## 基准测试（同口径）

- Round4: `docs/latency-baseline.round4.json`
- Round5: `docs/latency-baseline.round5.json`

| 场景 | 指标 | P50 (R4 -> R5) | P95 (R4 -> R5) | Max (R4 -> R5) |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.21 -> 0.19 | 0.31 -> 0.32 | 0.40 -> 0.39 |
| text-small | sendToFirstChunkMs | 0.24 -> 0.22 | 0.35 -> 0.35 | 0.43 -> 0.41 |
| text-large | sendToAckMs | 0.21 -> 0.18 | 0.41 -> 0.29 | 24.48 -> 0.42 |
| binary-large | sendToEchoMs | 0.19 -> 0.19 | 0.33 -> 0.36 | 10.33 -> 7.51 |
| binary-small | sendToEchoMs | 0.24 -> 0.21 | 0.90 -> 0.57 | 14.27 -> 25.55 |

## 结果结论

- ACK 长尾显著收敛（`text-large sendToAckMs max: 24.48 -> 0.42`）。
- PTY 大包场景 `binary-large` 的 max 有改善（`10.33 -> 7.51`），但仍有长尾。
- `binary-small` 出现更高偶发 max（`25.55`），说明系统仍有少量抖动源（非纯队列延迟），建议下一轮从事件循环拥塞与 Socket 发送确认维度继续观测。

## 验证

- `bun run typecheck` 通过
- 基准脚本执行成功并落盘:
  - `docs/latency-baseline.round5.md`
  - `docs/latency-baseline.round5.json`

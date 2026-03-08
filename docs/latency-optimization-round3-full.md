# 通信协议优化记录（Round 3 Full Baseline）

- 时间: 2026-03-03
- 口径: warmup=10, iterations=60
- 基线文件: `docs/latency-baseline.json`
- 本轮文件: `docs/latency-baseline.round3.full.json`

## 输出文件

- `docs/latency-baseline.round3.full.md`
- `docs/latency-baseline.round3.full.json`

## 关键对比（基线 -> Round3 Full）

| 场景 | 指标 | P50 | P95 | Max |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.38 -> 0.38 | 0.49 -> 0.59 | 0.53 -> 12.46 |
| text-small | sendToFirstChunkMs | 0.45 -> 0.45 | 0.55 -> 0.71 | 0.56 -> 23.08 |
| text-large | sendToAckMs | 0.28 -> 0.44 | 0.39 -> 0.61 | 0.43 -> 28.96 |
| text-large | sendToFirstChunkMs | 0.32 -> 0.54 | 0.49 -> 1.30 | 0.52 -> 29.08 |
| binary-small | sendToEchoMs | 0.33 -> 0.44 | 2.43 -> 0.69 | 10.71 -> 18.63 |
| binary-large | sendToEchoMs | 0.24 -> 0.43 | 0.37 -> 0.59 | 0.42 -> 1.35 |

## 观察

1. 文本链路的 P50 基本持平或变慢，P95 与 Max 明显变差，出现 10~30ms 级尾延迟尖峰。
2. `binary-small` 的 P95 有改善，但 Max 仍偏高。
3. `binary-large` 各分位整体变慢。
4. Relay Event Loop Lag 在本次运行里出现了 `max=122.64ms`，和尾延迟抬升相吻合。

## 结论

- Round3 方案在“稳定兜底”层面有效（stream_end 携带 finalText），但当前完整口径下未体现延迟收益。
- 下一轮应优先排查尾延迟来源（事件循环阻塞、批量 flush 时机、同进程调度争用），再继续做协议侧优化。

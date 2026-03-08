# Yuanio 真实 Agent 端到端延迟（Round1 三次中值）

- 生成时间: 2026-03-03T15:24:17.016Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-agent-e2e.round1.run1.json, docs/latency-agent-e2e.round1.run2.json, docs/latency-agent-e2e.round1.run3.json
- Agent: codex

## 握手中值

- pairCreateMs: 34.09 ms
- pairJoinMs: 22.09 ms
- appConnectMs: 10.30 ms

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.15 | 0.24 | 0.18 | 0.25 | 3.00 |
| sendToAckFirstMs | 0.70 | 4.34 | 1.94 | 4.77 | 3.00 |
| sendToAckWorkingMs | 0.70 | 4.34 | 1.94 | 4.77 | 3.00 |
| sendToAckOkMs | 11295.83 | 14600.66 | 12265.99 | 14716.14 | 3.00 |
| sendToFirstThinkingMs | 10169.42 | 13622.33 | 11304.86 | 13670.35 | 3.00 |
| sendToFirstChunkMs | 10128.56 | 13727.73 | 11622.99 | 13842.14 | 3.00 |
| sendToEndMs | 11288.63 | 14589.15 | 12259.04 | 14704.10 | 3.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

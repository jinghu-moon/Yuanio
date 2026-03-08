# Yuanio 真实 Agent 端到端延迟（Claude Round1 三次中值）

- 生成时间: 2026-03-03T15:47:28.859Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-agent-e2e.claude.round1.run1.json, docs/latency-agent-e2e.claude.round1.run2.json, docs/latency-agent-e2e.claude.round1.run3.json

## 场景: agent-e2e

| 指标 | P50 | P95 | Max |
|---|---:|---:|---:|
| sendToAckWorkingMs | 1.28 | 3.34 | 3.61 |
| sendToFirstChunkMs | 16349.83 | 22281.17 | 22940.21 |
| sendToEndMs | 18325.84 | 24421.89 | 25099.23 |
| sendToAckOkMs | 18336.69 | 24432.14 | 25109.41 |

# 真实 Agent 首包延迟对比（Round 1）

- 生成时间: 2026-03-03T15:50:05.048Z
- Codex: docs/latency-agent-e2e.round1.median.json
- Claude: docs/latency-agent-e2e.claude.round1.median.json

| 指标 | Codex P50 | Claude P50 | Codex P95 | Claude P95 | Codex Max | Claude Max | 建议 |
|---|---:|---:|---:|---:|---:|---:|---|
| sendToAckWorkingMs | 0.70 | 1.28 | 4.34 | 3.34 | 4.77 | 3.61 | 默认 Codex |
| sendToFirstChunkMs | 10128.56 | 16349.83 | 13727.73 | 22281.17 | 13842.14 | 22940.21 | 默认 Codex |
| sendToEndMs | 11288.63 | 18325.84 | 14589.15 | 24421.89 | 14704.10 | 25099.23 | 默认 Codex |
| sendToAckOkMs | 11295.83 | 18336.69 | 14600.66 | 24432.14 | 14716.14 | 25109.41 | 默认 Codex |

结论: 在当前机器和当前提示词下，`sendToFirstChunkMs` 与 `sendToEndMs` 上 Codex 明显快于 Claude，建议默认 agent 设为 Codex。

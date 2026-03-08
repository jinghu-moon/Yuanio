# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:45:52.942Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -1.12ms (RTT=0.29ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 49.61 |
| pairJoinMs | 23.92 |
| deriveAgentKeyMs | 0.55 |
| deriveAppKeyMs | 0.20 |
| appConnectMs | 10.75 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.19 | 0.19 | 0.19 | 0.19 | 3.00 |
| sendToAckFirstMs | 1.28 | 1.54 | 1.23 | 1.57 | 3.00 |
| sendToAckWorkingMs | 1.28 | 1.54 | 1.23 | 1.57 | 3.00 |
| sendToAckOkMs | 15111.57 | 18066.41 | 15856.16 | 18394.72 | 3.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 13770.04 | 16405.07 | 14118.77 | 16697.85 | 3.00 |
| sendToEndMs | 15103.10 | 18057.63 | 15848.01 | 18385.91 | 3.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

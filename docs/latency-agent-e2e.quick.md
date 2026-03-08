# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:02:19.011Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -6.74ms (RTT=0.29ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 34.40 |
| pairJoinMs | 21.92 |
| deriveAgentKeyMs | 0.71 |
| deriveAppKeyMs | 0.22 |
| appConnectMs | 11.02 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.15 | 0.15 | 0.15 | 0.15 | 1.00 |
| sendToAckFirstMs | 1.33 | 1.33 | 1.33 | 1.33 | 1.00 |
| sendToAckWorkingMs | 1.33 | 1.33 | 1.33 | 1.33 | 1.00 |
| sendToAckOkMs | 16599.16 | 16599.16 | 16599.16 | 16599.16 | 1.00 |
| sendToFirstThinkingMs | 15875.39 | 15875.39 | 15875.39 | 15875.39 | 1.00 |
| sendToFirstChunkMs | 15769.89 | 15769.89 | 15769.89 | 15769.89 | 1.00 |
| sendToEndMs | 16592.15 | 16592.15 | 16592.15 | 16592.15 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

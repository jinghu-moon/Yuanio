# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:05:22.086Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -10.29ms (RTT=0.29ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 34.32 |
| pairJoinMs | 21.96 |
| deriveAgentKeyMs | 0.58 |
| deriveAppKeyMs | 0.38 |
| appConnectMs | 12.09 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.36 | 0.36 | 0.36 | 0.36 | 1.00 |
| sendToAckFirstMs | 1.25 | 1.25 | 1.25 | 1.25 | 1.00 |
| sendToAckWorkingMs | 1.25 | 1.25 | 1.25 | 1.25 | 1.00 |
| sendToAckOkMs | 22919.92 | 22919.92 | 22919.92 | 22919.92 | 1.00 |
| sendToFirstThinkingMs | 21951.75 | 21951.75 | 21951.75 | 21951.75 | 1.00 |
| sendToFirstChunkMs | 21821.58 | 21821.58 | 21821.58 | 21821.58 | 1.00 |
| sendToEndMs | 22913.09 | 22913.09 | 22913.09 | 22913.09 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

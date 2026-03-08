# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:14:33.406Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -4.41ms (RTT=0.35ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 40.29 |
| pairJoinMs | 24.84 |
| deriveAgentKeyMs | 0.56 |
| deriveAppKeyMs | 0.19 |
| appConnectMs | 11.39 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=116B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.19 | 0.19 | 0.19 | 0.19 | 1.00 |
| sendToAckFirstMs | 4.08 | 4.08 | 4.08 | 4.08 | 1.00 |
| sendToAckWorkingMs | 4.08 | 4.08 | 4.08 | 4.08 | 1.00 |
| sendToAckOkMs | 26254.02 | 26254.02 | 26254.02 | 26254.02 | 1.00 |
| sendToFirstThinkingMs | 21601.35 | 21601.35 | 21601.35 | 21601.35 | 1.00 |
| sendToFirstChunkMs | 25459.24 | 25459.24 | 25459.24 | 25459.24 | 1.00 |
| sendToEndMs | 26247.60 | 26247.60 | 26247.60 | 26247.60 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 395.00 | 395.00 | 395.00 | 395.00 | 1.00 |

# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:35:06.736Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -7.16ms (RTT=0.37ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 33.75 |
| pairJoinMs | 22.95 |
| deriveAgentKeyMs | 0.50 |
| deriveAppKeyMs | 0.19 |
| appConnectMs | 12.36 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.19 | 0.19 | 0.19 | 0.19 | 1.00 |
| sendToAckFirstMs | 3.07 | 3.07 | 3.07 | 3.07 | 1.00 |
| sendToAckWorkingMs | 3.07 | 3.07 | 3.07 | 3.07 | 1.00 |
| sendToAckOkMs | 25017.96 | 25017.96 | 25017.96 | 25017.96 | 1.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToEndMs | 25007.08 | 25007.08 | 25007.08 | 25007.08 | 1.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkChars | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |

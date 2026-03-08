# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:47:05.191Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -1.94ms (RTT=0.36ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 35.36 |
| pairJoinMs | 21.89 |
| deriveAgentKeyMs | 0.65 |
| deriveAppKeyMs | 0.22 |
| appConnectMs | 11.86 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.21 | 0.24 | 0.21 | 0.25 | 3.00 |
| sendToAckFirstMs | 0.86 | 3.34 | 1.75 | 3.61 | 3.00 |
| sendToAckWorkingMs | 0.86 | 3.34 | 1.75 | 3.61 | 3.00 |
| sendToAckOkMs | 18336.69 | 24432.14 | 20209.16 | 25109.41 | 3.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 16349.83 | 22281.17 | 18513.27 | 22940.21 | 3.00 |
| sendToEndMs | 18325.84 | 24421.89 | 20198.88 | 25099.23 | 3.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

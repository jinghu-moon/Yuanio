# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:42:03.889Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -0.35ms (RTT=0.33ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 38.55 |
| pairJoinMs | 22.94 |
| deriveAgentKeyMs | 0.88 |
| deriveAppKeyMs | 0.36 |
| appConnectMs | 14.09 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.16 | 0.16 | 0.16 | 0.16 | 1.00 |
| sendToAckFirstMs | 1.76 | 1.76 | 1.76 | 1.76 | 1.00 |
| sendToAckWorkingMs | 1.76 | 1.76 | 1.76 | 1.76 | 1.00 |
| sendToAckOkMs | 19727.17 | 19727.17 | 19727.17 | 19727.17 | 1.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToEndMs | 19719.71 | 19719.71 | 19719.71 | 19719.71 | 1.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkChars | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |

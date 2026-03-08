# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:06:54.350Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -11.73ms (RTT=0.25ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 39.54 |
| pairJoinMs | 23.76 |
| deriveAgentKeyMs | 1.07 |
| deriveAppKeyMs | 0.33 |
| appConnectMs | 10.48 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.16 | 0.16 | 0.16 | 0.16 | 1.00 |
| sendToAckFirstMs | 1.37 | 1.37 | 1.37 | 1.37 | 1.00 |
| sendToAckWorkingMs | 1.37 | 1.37 | 1.37 | 1.37 | 1.00 |
| sendToAckOkMs | 19315.48 | 19315.48 | 19315.48 | 19315.48 | 1.00 |
| sendToFirstThinkingMs | 18619.69 | 18619.69 | 18619.69 | 18619.69 | 1.00 |
| sendToFirstChunkMs | 18800.31 | 18800.31 | 18800.31 | 18800.31 | 1.00 |
| sendToEndMs | 19308.45 | 19308.45 | 19308.45 | 19308.45 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

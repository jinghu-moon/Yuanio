# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:44:54.239Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -3.46ms (RTT=0.22ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 106.71 |
| pairJoinMs | 23.55 |
| deriveAgentKeyMs | 1.16 |
| deriveAppKeyMs | 0.41 |
| appConnectMs | 10.80 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.20 | 0.49 | 0.28 | 0.52 | 3.00 |
| sendToAckFirstMs | 1.44 | 4.08 | 2.15 | 4.37 | 3.00 |
| sendToAckWorkingMs | 1.44 | 4.08 | 2.15 | 4.37 | 3.00 |
| sendToAckOkMs | 25171.47 | 26809.79 | 23069.31 | 26991.82 | 3.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 22320.54 | 25178.61 | 21244.85 | 25496.17 | 3.00 |
| sendToEndMs | 25160.48 | 26802.68 | 23052.48 | 26985.15 | 3.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

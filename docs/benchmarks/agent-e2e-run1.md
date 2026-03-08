# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T17:03:05.481Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -0.33ms (RTT=0.44ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 40.59 |
| pairJoinMs | 22.73 |
| deriveAgentKeyMs | 0.59 |
| deriveAppKeyMs | 0.25 |
| appConnectMs | 15.79 |

## 场景: agent-e2e

- Warmup: 1
- Iterations: 4
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.13 | 0.38 | 0.20 | 0.43 | 4.00 |
| sendToAckFirstMs | 25.03 | 28.06 | 25.58 | 28.42 | 4.00 |
| sendToAckWorkingMs | 25.03 | 28.06 | 25.58 | 28.42 | 4.00 |
| sendToAckOkMs | 11825.63 | 12930.48 | 11315.08 | 13036.60 | 4.00 |
| sendToFirstThinkingMs | 25.10 | 28.13 | 25.64 | 28.48 | 4.00 |
| sendToFirstChunkMs | 10960.04 | 12063.57 | 10451.57 | 12176.76 | 4.00 |
| sendToEndMs | 11825.70 | 12930.63 | 11315.38 | 13036.77 | 4.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 4.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 4.00 |
| chunkChars | 3.00 | 3.00 | 2.75 | 3.00 | 4.00 |

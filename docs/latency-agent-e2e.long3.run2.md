# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:13:57.757Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -4.46ms (RTT=0.22ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 30.10 |
| pairJoinMs | 23.01 |
| deriveAgentKeyMs | 0.79 |
| deriveAppKeyMs | 0.26 |
| appConnectMs | 12.07 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=116B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.19 | 0.19 | 0.19 | 0.19 | 1.00 |
| sendToAckFirstMs | 1.28 | 1.28 | 1.28 | 1.28 | 1.00 |
| sendToAckWorkingMs | 1.28 | 1.28 | 1.28 | 1.28 | 1.00 |
| sendToAckOkMs | 24213.19 | 24213.19 | 24213.19 | 24213.19 | 1.00 |
| sendToFirstThinkingMs | 19707.21 | 19707.21 | 19707.21 | 19707.21 | 1.00 |
| sendToFirstChunkMs | 23671.08 | 23671.08 | 23671.08 | 23671.08 | 1.00 |
| sendToEndMs | 24204.71 | 24204.71 | 24204.71 | 24204.71 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 398.00 | 398.00 | 398.00 | 398.00 | 1.00 |

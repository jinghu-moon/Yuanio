# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:13:23.842Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -4.00ms (RTT=0.30ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 35.00 |
| pairJoinMs | 21.84 |
| deriveAgentKeyMs | 0.53 |
| deriveAppKeyMs | 0.22 |
| appConnectMs | 10.86 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=116B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.18 | 0.18 | 0.18 | 0.18 | 1.00 |
| sendToAckFirstMs | 2.66 | 2.66 | 2.66 | 2.66 | 1.00 |
| sendToAckWorkingMs | 2.66 | 2.66 | 2.66 | 2.66 | 1.00 |
| sendToAckOkMs | 32263.78 | 32263.78 | 32263.78 | 32263.78 | 1.00 |
| sendToFirstThinkingMs | 27806.08 | 27806.08 | 27806.08 | 27806.08 | 1.00 |
| sendToFirstChunkMs | 31479.54 | 31479.54 | 31479.54 | 31479.54 | 1.00 |
| sendToEndMs | 32256.34 | 32256.34 | 32256.34 | 32256.34 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 395.00 | 395.00 | 395.00 | 395.00 | 1.00 |

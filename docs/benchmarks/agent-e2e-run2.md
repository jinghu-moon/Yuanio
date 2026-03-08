# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T17:04:35.864Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -15.55ms (RTT=0.24ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 37.70 |
| pairJoinMs | 22.01 |
| deriveAgentKeyMs | 0.78 |
| deriveAppKeyMs | 0.29 |
| appConnectMs | 10.74 |

## 场景: agent-e2e

- Warmup: 1
- Iterations: 4
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.15 | 0.20 | 0.16 | 0.21 | 4.00 |
| sendToAckFirstMs | 26.99 | 30.67 | 27.59 | 31.27 | 4.00 |
| sendToAckWorkingMs | 26.99 | 30.67 | 27.59 | 31.27 | 4.00 |
| sendToAckOkMs | 12027.73 | 21809.51 | 14101.29 | 23157.92 | 4.00 |
| sendToFirstThinkingMs | 27.03 | 30.71 | 27.63 | 31.31 | 4.00 |
| sendToFirstChunkMs | 11066.05 | 20866.86 | 13190.42 | 22219.30 | 4.00 |
| sendToEndMs | 12027.80 | 21810.80 | 14101.72 | 23159.43 | 4.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 4.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 4.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 4.00 |

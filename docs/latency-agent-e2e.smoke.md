# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:01:10.257Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -9.60ms (RTT=0.44ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 41.51 |
| pairJoinMs | 23.94 |
| deriveAgentKeyMs | 0.86 |
| deriveAppKeyMs | 0.36 |
| appConnectMs | 11.46 |

## 场景: agent-e2e

- Warmup: 1
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.11 | 0.11 | 0.11 | 0.11 | 1.00 |
| sendToAckFirstMs | 7.66 | 7.66 | 7.66 | 7.66 | 1.00 |
| sendToAckWorkingMs | 7.66 | 7.66 | 7.66 | 7.66 | 1.00 |
| sendToAckOkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstThinkingMs | 22151.92 | 22151.92 | 22151.92 | 22151.92 | 1.00 |
| sendToFirstChunkMs | 22054.87 | 22054.87 | 22054.87 | 22054.87 | 1.00 |
| sendToEndMs | 23109.20 | 23109.20 | 23109.20 | 23109.20 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

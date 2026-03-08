# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:22:51.851Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -10.76ms (RTT=0.20ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 32.67 |
| pairJoinMs | 22.09 |
| deriveAgentKeyMs | 0.60 |
| deriveAppKeyMs | 0.21 |
| appConnectMs | 11.20 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.18 | 0.24 | 0.18 | 0.25 | 3.00 |
| sendToAckFirstMs | 3.76 | 11.66 | 5.62 | 12.54 | 3.00 |
| sendToAckWorkingMs | 3.76 | 11.66 | 5.62 | 12.54 | 3.00 |
| sendToAckOkMs | 11295.83 | 11664.58 | 11172.37 | 11705.55 | 3.00 |
| sendToFirstThinkingMs | 9683.85 | 10716.23 | 10041.09 | 10830.93 | 3.00 |
| sendToFirstChunkMs | 10128.56 | 10781.22 | 10200.58 | 10853.73 | 3.00 |
| sendToEndMs | 11288.63 | 11657.51 | 11165.02 | 11698.49 | 3.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

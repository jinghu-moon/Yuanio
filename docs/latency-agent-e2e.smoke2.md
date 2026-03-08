# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:21:03.612Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -8.95ms (RTT=0.29ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 33.07 |
| pairJoinMs | 22.76 |
| deriveAgentKeyMs | 0.54 |
| deriveAppKeyMs | 0.24 |
| appConnectMs | 10.92 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.17 | 0.17 | 0.17 | 0.17 | 1.00 |
| sendToAckFirstMs | 1.38 | 1.38 | 1.38 | 1.38 | 1.00 |
| sendToAckWorkingMs | 1.38 | 1.38 | 1.38 | 1.38 | 1.00 |
| sendToAckOkMs | 12442.30 | 12442.30 | 12442.30 | 12442.30 | 1.00 |
| sendToFirstThinkingMs | 11382.52 | 11382.52 | 11382.52 | 11382.52 | 1.00 |
| sendToFirstChunkMs | 11633.38 | 11633.38 | 11633.38 | 11633.38 | 1.00 |
| sendToEndMs | 12434.45 | 12434.45 | 12434.45 | 12434.45 | 1.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

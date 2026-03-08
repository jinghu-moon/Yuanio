# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T17:08:11.179Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -26.99ms (RTT=0.27ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 35.56 |
| pairJoinMs | 22.07 |
| deriveAgentKeyMs | 0.53 |
| deriveAppKeyMs | 0.23 |
| appConnectMs | 10.07 |

## 场景: agent-e2e

- Warmup: 1
- Iterations: 4
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.15 | 0.23 | 0.16 | 0.24 | 4.00 |
| sendToAckFirstMs | 31.57 | 47.11 | 34.66 | 49.85 | 4.00 |
| sendToAckWorkingMs | 31.57 | 47.11 | 34.66 | 49.85 | 4.00 |
| sendToAckOkMs | 11444.21 | 13764.94 | 12018.52 | 14148.78 | 4.00 |
| sendToFirstThinkingMs | 31.62 | 70.28 | 41.51 | 77.10 | 4.00 |
| sendToFirstChunkMs | 10579.51 | 12961.71 | 11073.99 | 13305.40 | 4.00 |
| sendToEndMs | 11445.05 | 13765.28 | 12019.01 | 14148.89 | 4.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 4.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 4.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 4.00 |

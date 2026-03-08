# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T16:32:16.691Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: 0.00ms (RTT=0.30ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 32.77 |
| pairJoinMs | 22.74 |
| deriveAgentKeyMs | 0.57 |
| deriveAppKeyMs | 0.22 |
| appConnectMs | 10.72 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.84 | 0.84 | 0.84 | 0.84 | 1.00 |
| sendToAckFirstMs | 2.06 | 2.06 | 2.06 | 2.06 | 1.00 |
| sendToAckWorkingMs | 2.06 | 2.06 | 2.06 | 2.06 | 1.00 |
| sendToAckOkMs | 13825.78 | 13825.78 | 13825.78 | 13825.78 | 1.00 |
| sendToFirstThinkingMs | 16.89 | 16.89 | 16.89 | 16.89 | 1.00 |
| sendToFirstChunkMs | 13528.82 | 13528.82 | 13528.82 | 13528.82 | 1.00 |
| sendToEndMs | 13818.47 | 13818.47 | 13818.47 | 13818.47 | 1.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

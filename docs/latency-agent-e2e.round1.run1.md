# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:22:06.613Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -8.20ms (RTT=0.29ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 39.45 |
| pairJoinMs | 23.94 |
| deriveAgentKeyMs | 0.82 |
| deriveAppKeyMs | 0.34 |
| appConnectMs | 10.30 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.13 | 0.92 | 0.42 | 1.00 | 3.00 |
| sendToAckFirstMs | 0.53 | 4.34 | 1.94 | 4.77 | 3.00 |
| sendToAckWorkingMs | 0.53 | 4.34 | 1.94 | 4.77 | 3.00 |
| sendToAckOkMs | 10936.84 | 15301.45 | 12265.99 | 15786.40 | 3.00 |
| sendToFirstThinkingMs | 10169.42 | 14397.21 | 11304.86 | 14866.96 | 3.00 |
| sendToFirstChunkMs | 10085.05 | 14607.08 | 11622.99 | 15109.53 | 3.00 |
| sendToEndMs | 10930.29 | 15294.44 | 12259.04 | 15779.35 | 3.00 |
| thinkingCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 2.67 | 3.00 | 3.00 |

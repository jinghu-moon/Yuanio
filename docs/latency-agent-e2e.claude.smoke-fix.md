# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:43:19.623Z
- Agent: claude
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -2.07ms (RTT=0.45ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 32.30 |
| pairJoinMs | 27.05 |
| deriveAgentKeyMs | 0.54 |
| deriveAppKeyMs | 0.17 |
| appConnectMs | 10.77 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.16 | 0.16 | 0.16 | 0.16 | 1.00 |
| sendToAckFirstMs | 1.45 | 1.45 | 1.45 | 1.45 | 1.00 |
| sendToAckWorkingMs | 1.45 | 1.45 | 1.45 | 1.45 | 1.00 |
| sendToAckOkMs | 19225.34 | 19225.34 | 19225.34 | 19225.34 | 1.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 18041.45 | 18041.45 | 18041.45 | 18041.45 | 1.00 |
| sendToEndMs | 19213.94 | 19213.94 | 19213.94 | 19213.94 | 1.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |

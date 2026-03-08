# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-03T15:23:42.864Z
- Agent: codex
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -10.14ms (RTT=0.43ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 34.09 |
| pairJoinMs | 22.03 |
| deriveAgentKeyMs | 0.63 |
| deriveAppKeyMs | 0.19 |
| appConnectMs | 9.97 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 3
- Payload: prompt=55B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.15 | 0.20 | 0.16 | 0.20 | 3.00 |
| sendToAckFirstMs | 0.70 | 1.29 | 0.90 | 1.36 | 3.00 |
| sendToAckWorkingMs | 0.70 | 1.29 | 0.90 | 1.36 | 3.00 |
| sendToAckOkMs | 13561.33 | 14600.66 | 13547.78 | 14716.14 | 3.00 |
| sendToFirstThinkingMs | 13190.17 | 13622.33 | 13190.17 | 13670.35 | 2.00 |
| sendToFirstChunkMs | 12698.04 | 13727.73 | 12602.00 | 13842.14 | 3.00 |
| sendToEndMs | 13554.59 | 14589.15 | 13538.89 | 14704.10 | 3.00 |
| thinkingCount | 1.00 | 1.00 | 0.67 | 1.00 | 3.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 3.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |

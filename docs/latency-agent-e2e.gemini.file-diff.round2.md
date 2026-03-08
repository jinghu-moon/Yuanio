# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-04T03:51:45.702Z
- Agent: gemini
- PermissionMode: yolo
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -26.41ms (RTT=0.38ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 32.89 |
| pairJoinMs | 23.06 |
| deriveAgentKeyMs | 0.54 |
| deriveAppKeyMs | 0.16 |
| appConnectMs | 12.71 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=207B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.19 | 0.19 | 0.19 | 0.19 | 1.00 |
| sendToAckFirstMs | 47.05 | 47.05 | 47.05 | 47.05 | 1.00 |
| sendToAckWorkingMs | 47.05 | 47.05 | 47.05 | 47.05 | 1.00 |
| sendToAckOkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstThinkingMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstChunkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstFileDiffMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToEndMs | 47.16 | 47.16 | 47.16 | 47.16 | 1.00 |
| thinkingCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| chunkChars | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |
| fileDiffCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |

### FILE_DIFF 样本

- 未捕获到 file_diff 事件

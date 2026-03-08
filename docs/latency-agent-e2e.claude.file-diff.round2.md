# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-04T03:51:18.459Z
- Agent: claude
- PermissionMode: yolo
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -25.32ms (RTT=0.41ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 36.21 |
| pairJoinMs | 24.00 |
| deriveAgentKeyMs | 0.63 |
| deriveAppKeyMs | 0.23 |
| appConnectMs | 14.29 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=207B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.22 | 0.22 | 0.22 | 0.22 | 1.00 |
| sendToAckFirstMs | 29.28 | 29.28 | 29.28 | 29.28 | 1.00 |
| sendToAckWorkingMs | 29.28 | 29.28 | 29.28 | 29.28 | 1.00 |
| sendToAckOkMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToFirstThinkingMs | 29.47 | 29.47 | 29.47 | 29.47 | 1.00 |
| sendToFirstChunkMs | 9956.83 | 9956.83 | 9956.83 | 9956.83 | 1.00 |
| sendToFirstFileDiffMs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sendToEndMs | 10145.05 | 10145.05 | 10145.05 | 10145.05 | 1.00 |
| thinkingCount | 10.00 | 10.00 | 10.00 | 10.00 | 1.00 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 33.00 | 33.00 | 33.00 | 33.00 | 1.00 |
| fileDiffCount | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |

### FILE_DIFF 样本

- 未捕获到 file_diff 事件

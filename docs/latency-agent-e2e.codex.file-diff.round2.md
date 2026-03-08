# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-04T03:44:19.449Z
- Agent: codex
- PermissionMode: yolo
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -7.63ms (RTT=0.39ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 36.21 |
| pairJoinMs | 22.97 |
| deriveAgentKeyMs | 0.54 |
| deriveAppKeyMs | 0.20 |
| appConnectMs | 13.01 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=241B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.16 | 0.16 | 0.16 | 0.16 | 1.00 |
| sendToAckFirstMs | 30.91 | 30.91 | 30.91 | 30.91 | 1.00 |
| sendToAckWorkingMs | 30.91 | 30.91 | 30.91 | 30.91 | 1.00 |
| sendToAckOkMs | 26168.43 | 26168.43 | 26168.43 | 26168.43 | 1.00 |
| sendToFirstThinkingMs | 31.23 | 31.23 | 31.23 | 31.23 | 1.00 |
| sendToFirstChunkMs | 14680.49 | 14680.49 | 14680.49 | 14680.49 | 1.00 |
| sendToFirstFileDiffMs | 15308.85 | 15308.85 | 15308.85 | 15308.85 | 1.00 |
| sendToEndMs | 26168.48 | 26168.48 | 26168.48 | 26168.48 | 1.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |
| chunkCount | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |
| chunkChars | 162.00 | 162.00 | 162.00 | 162.00 | 1.00 |
| fileDiffCount | 2.00 | 2.00 | 2.00 | 2.00 | 1.00 |

### FILE_DIFF 样本

| path | action | diff preview |
|---|---|---|
| D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared.txt | created |  |
| D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared.txt | modified |  |

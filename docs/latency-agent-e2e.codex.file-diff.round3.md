# Yuanio 真实 Agent 端到端延迟基线

- 生成时间: 2026-03-04T06:34:33.533Z
- Agent: codex
- PermissionMode: yolo
- Server: http://127.0.0.1:3000
- Relay 偏移估算: -1.10ms (RTT=0.41ms, 样本=7)

## 握手开销

| 指标 | 毫秒 |
|---|---:|
| pairCreateMs | 32.77 |
| pairJoinMs | 22.02 |
| deriveAgentKeyMs | 0.53 |
| deriveAppKeyMs | 0.21 |
| appConnectMs | 13.78 |

## 场景: agent-e2e

- Warmup: 0
- Iterations: 1
- Payload: prompt=162B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.24 | 0.24 | 0.24 | 0.24 | 1.00 |
| sendToAckFirstMs | 31.53 | 31.53 | 31.53 | 31.53 | 1.00 |
| sendToAckWorkingMs | 31.53 | 31.53 | 31.53 | 31.53 | 1.00 |
| sendToAckOkMs | 22246.40 | 22246.40 | 22246.40 | 22246.40 | 1.00 |
| sendToFirstThinkingMs | 31.92 | 31.92 | 31.92 | 31.92 | 1.00 |
| sendToFirstChunkMs | 14710.79 | 14710.79 | 14710.79 | 14710.79 | 1.00 |
| sendToFirstFileDiffMs | 15008.04 | 15008.04 | 15008.04 | 15008.04 | 1.00 |
| sendToEndMs | 22246.47 | 22246.47 | 22246.47 | 22246.47 | 1.00 |
| thinkingCount | 3.00 | 3.00 | 3.00 | 3.00 | 1.00 |
| chunkCount | 2.00 | 2.00 | 2.00 | 2.00 | 1.00 |
| chunkChars | 44.00 | 44.00 | 44.00 | 44.00 | 1.00 |
| fileDiffCount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

### FILE_DIFF 样本

| path | action | diff preview |
|---|---|---|
| D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared-create-only.txt | created | --- a/D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared-create-only.txt\n+++ b/D:\100_Projects\110_Daily\Yuanio\tmp/e2e-file-diff/protocol-bench-shared-create-only.txt\n@@ preview @@\n-\n+alpha\n+beta |

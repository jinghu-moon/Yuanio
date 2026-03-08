# Yuanio 真实 Agent 端到端延迟（3次中值）

- 生成时间: 2026-03-03T16:08:35.9605986Z
- Agent: codex
- Warmup: 0
- Iterations: 1

| 指标 | run1 | run2 | run3 | 中值 |
|---|---:|---:|---:|---:|
| sendToAckFirstMs | 2.18 | 1.25 | 1.37 | 1.37 |
| sendToAckWorkingMs | 2.18 | 1.25 | 1.37 | 1.37 |
| sendToFirstThinkingMs | 11,035.10 | 21,951.75 | 18,619.69 | 18,619.69 |
| sendToFirstChunkMs | 11,034.20 | 21,821.58 | 18,800.31 | 18,800.31 |
| sendToEndMs | 11,899.87 | 22,913.09 | 19,308.45 | 19,308.45 |
| sendToAckOkMs | 11,910.79 | 22,919.92 | 19,315.48 | 19,315.48 |
| chunkCount | 1.00 | 1.00 | 1.00 | 1.00 |
| chunkChars | 3.00 | 3.00 | 3.00 | 3.00 |

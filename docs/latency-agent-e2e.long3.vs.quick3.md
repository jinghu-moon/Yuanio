# 长提示词 vs 短提示词（3次中值对比）

- 生成时间: 2026-03-03T16:15:15.2136158Z
- 短提示词中值: docs/latency-agent-e2e.quick3.median.json
- 长提示词中值: docs/latency-agent-e2e.long3.median.json

| 指标 | 短提示词中值 | 长提示词中值 | 差值(长-短) |
|---|---:|---:|---:|
| sendToAckWorkingMs | 1.37 | 2.66 | 1.29 |
| sendToFirstChunkMs | 18,800.31 | 25,459.24 | 6,658.93 |
| sendToEndMs | 19,308.45 | 26,247.60 | 6,939.15 |
| chunkCount | 1.00 | 1.00 | 0.00 |
| chunkChars | 3.00 | 395.00 | 392.00 |

# Yuanio 通信延迟基线报告（Round9 三次中值）

- 生成时间: 2026-03-03T14:45:20.798Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-baseline.round9.run1.json, docs/latency-baseline.round9.run2.json, docs/latency-baseline.round9.run3.json

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.05 | 0.04 | 0.18 | 60.00 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.05 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.05 | 0.04 | 0.16 | 60.00 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.13 | 60.00 |
| sendToRelayMs | 0.03 | 0.42 | 0.00 | 0.53 | 60.00 |
| relayToAgentMs | 0.10 | 0.46 | 0.09 | 0.54 | 60.00 |
| sendToAgentMs | 0.08 | 0.12 | 0.08 | 0.13 | 60.00 |
| sendToAckMs | 0.23 | 0.33 | 0.24 | 0.36 | 60.00 |
| sendToFirstChunkMs | 0.26 | 0.37 | 0.27 | 0.43 | 60.00 |
| agentChunkToAppMs | 0.12 | 0.53 | 0.12 | 0.89 | 60.00 |
| sendToEndMs | 0.30 | 0.43 | 0.31 | 0.51 | 60.00 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60.00 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.10 | 60.00 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.05 | 0.18 | 60.00 |
| appDecryptChunkMs | 0.04 | 0.09 | 0.05 | 0.14 | 60.00 |
| sendToRelayMs | 0.00 | 0.43 | 0.00 | 0.72 | 60.00 |
| relayToAgentMs | 0.07 | 0.56 | 0.08 | 0.59 | 60.00 |
| sendToAgentMs | 0.07 | 0.13 | 0.08 | 0.23 | 60.00 |
| sendToAckMs | 0.23 | 0.78 | 0.71 | 14.64 | 60.00 |
| sendToFirstChunkMs | 0.30 | 0.82 | 0.76 | 14.70 | 60.00 |
| agentChunkToAppMs | 0.14 | 0.78 | 0.42 | 14.01 | 60.00 |
| sendToEndMs | 0.33 | 1.75 | 0.81 | 14.77 | 60.00 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.11 | 60.00 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60.00 |
| agentEncodeMs | 0.04 | 0.07 | 0.04 | 0.13 | 60.00 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60.00 |
| sendToAgentMs | 0.10 | 0.23 | 0.27 | 7.64 | 60.00 |
| sendToEchoMs | 0.28 | 0.95 | 0.70 | 8.84 | 60.00 |
| agentToAppMs | 0.08 | 0.50 | 0.27 | 8.52 | 60.00 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.08 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.02 | 0.05 | 60.00 |
| agentEncodeMs | 0.03 | 0.05 | 0.04 | 0.09 | 60.00 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60.00 |
| sendToAgentMs | 0.06 | 0.14 | 0.09 | 1.20 | 60.00 |
| sendToEchoMs | 0.19 | 0.36 | 0.22 | 1.39 | 60.00 |
| agentToAppMs | 0.07 | 0.51 | 0.07 | 0.55 | 60.00 |

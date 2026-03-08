# Yuanio 通信延迟基线报告（Round10 三次中值）

- 生成时间: 2026-03-03T14:48:12.762Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-baseline.round10.run1.json, docs/latency-baseline.round10.run2.json, docs/latency-baseline.round10.run3.json

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.04 | 0.10 | 60.00 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.09 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.11 | 60.00 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.18 | 60.00 |
| sendToRelayMs | 0.04 | 0.45 | 0.04 | 0.49 | 60.00 |
| relayToAgentMs | 0.03 | 0.47 | 0.03 | 0.50 | 60.00 |
| sendToAgentMs | 0.07 | 0.11 | 0.07 | 0.20 | 60.00 |
| sendToAckMs | 0.23 | 0.33 | 0.24 | 0.43 | 60.00 |
| sendToFirstChunkMs | 0.25 | 0.38 | 0.27 | 0.61 | 60.00 |
| agentChunkToAppMs | 0.20 | 0.61 | 0.20 | 0.69 | 60.00 |
| sendToEndMs | 0.30 | 0.47 | 0.32 | 0.75 | 60.00 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.07 | 60.00 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.17 | 60.00 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.06 | 0.26 | 60.00 |
| appDecryptChunkMs | 0.05 | 0.07 | 0.05 | 0.13 | 60.00 |
| sendToRelayMs | 0.03 | 0.47 | 0.01 | 0.49 | 60.00 |
| relayToAgentMs | 0.04 | 0.51 | 0.06 | 0.54 | 60.00 |
| sendToAgentMs | 0.06 | 0.11 | 0.07 | 0.14 | 60.00 |
| sendToAckMs | 0.23 | 0.44 | 0.45 | 11.38 | 60.00 |
| sendToFirstChunkMs | 0.28 | 0.76 | 0.65 | 14.70 | 60.00 |
| agentChunkToAppMs | 0.25 | 0.78 | 0.63 | 15.02 | 60.00 |
| sendToEndMs | 0.32 | 2.17 | 0.69 | 14.76 | 60.00 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.12 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.06 | 60.00 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.10 | 60.00 |
| appDecryptMs | 0.02 | 0.05 | 0.04 | 0.17 | 60.00 |
| sendToAgentMs | 0.08 | 0.15 | 0.21 | 7.61 | 60.00 |
| sendToEchoMs | 0.21 | 0.78 | 0.74 | 15.96 | 60.00 |
| agentToAppMs | 0.19 | 0.71 | 0.62 | 15.48 | 60.00 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.08 | 60.00 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.06 | 60.00 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.16 | 60.00 |
| appDecryptMs | 0.03 | 0.04 | 0.04 | 0.32 | 60.00 |
| sendToAgentMs | 0.07 | 0.13 | 0.08 | 0.17 | 60.00 |
| sendToEchoMs | 0.20 | 0.37 | 0.36 | 7.48 | 60.00 |
| agentToAppMs | 0.18 | 0.61 | 0.20 | 1.44 | 60.00 |

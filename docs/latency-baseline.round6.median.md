# Yuanio 通信延迟基线报告（Round6 三次中值）

- 生成时间: 2026-03-03T14:19:28.044Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-baseline.round6.run1.json, docs/latency-baseline.round6.run2.json, docs/latency-baseline.round6.run3.json

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.18 | 60.00 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.14 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.09 | 60.00 |
| appDecryptChunkMs | 0.03 | 0.08 | 0.04 | 0.18 | 60.00 |
| sendToRelayMs | -0.21 | 0.26 | -0.18 | 0.34 | 60.00 |
| relayToAgentMs | 0.26 | 0.70 | 0.26 | 0.73 | 60.00 |
| sendToAgentMs | 0.07 | 0.12 | 0.08 | 0.23 | 60.00 |
| sendToAckMs | 0.23 | 0.37 | 0.26 | 0.52 | 60.00 |
| sendToFirstChunkMs | 0.27 | 0.44 | 0.30 | 0.65 | 60.00 |
| agentChunkToAppMs | -0.26 | 0.18 | -0.27 | 0.27 | 60.00 |
| sendToEndMs | 0.30 | 0.53 | 0.35 | 0.71 | 60.00 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.05 | 0.15 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.05 | 60.00 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.11 | 60.00 |
| appDecryptChunkMs | 0.04 | 0.12 | 0.07 | 0.30 | 60.00 |
| sendToRelayMs | -0.17 | 0.24 | -0.18 | 1.02 | 60.00 |
| relayToAgentMs | 0.26 | 0.69 | 0.26 | 0.73 | 60.00 |
| sendToAgentMs | 0.06 | 0.12 | 0.07 | 0.20 | 60.00 |
| sendToAckMs | 0.21 | 0.33 | 0.46 | 8.01 | 60.00 |
| sendToFirstChunkMs | 0.26 | 0.75 | 0.64 | 9.13 | 60.00 |
| agentChunkToAppMs | -0.19 | 0.80 | 0.60 | 9.40 | 60.00 |
| sendToEndMs | 0.30 | 2.64 | 0.74 | 9.21 | 60.00 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.11 | 60.00 |
| agentDecryptMs | 0.02 | 0.05 | 0.04 | 0.16 | 60.00 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60.00 |
| appDecryptMs | 0.02 | 0.06 | 0.03 | 0.08 | 60.00 |
| sendToAgentMs | 0.08 | 0.20 | 0.33 | 14.91 | 60.00 |
| sendToEchoMs | 0.23 | 0.36 | 0.72 | 20.12 | 60.00 |
| agentToAppMs | -0.23 | 0.24 | -0.16 | 6.65 | 60.00 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.09 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.13 | 60.00 |
| agentEncodeMs | 0.04 | 0.07 | 0.05 | 0.14 | 60.00 |
| appDecryptMs | 0.03 | 0.06 | 0.05 | 1.30 | 60.00 |
| sendToAgentMs | 0.07 | 0.18 | 0.13 | 0.33 | 60.00 |
| sendToEchoMs | 0.20 | 0.48 | 0.35 | 1.32 | 60.00 |
| agentToAppMs | -0.30 | 0.16 | -0.29 | 0.40 | 60.00 |

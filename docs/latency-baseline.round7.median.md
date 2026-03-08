# Yuanio 通信延迟基线报告（Round7 三次中值）

- 生成时间: 2026-03-03T14:38:09.537Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-baseline.round7.run1.json, docs/latency-baseline.round7.run2.json, docs/latency-baseline.round7.run3.json

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.07 | 0.04 | 0.11 | 60.00 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.19 | 60.00 |
| appDecryptChunkMs | 0.03 | 0.12 | 0.04 | 0.15 | 60.00 |
| sendToRelayMs | 0.27 | 0.75 | 0.32 | 0.96 | 60.00 |
| relayToAgentMs | -0.20 | 0.22 | -0.23 | 0.46 | 60.00 |
| sendToAgentMs | 0.08 | 0.14 | 0.09 | 0.52 | 60.00 |
| sendToAckMs | 0.25 | 0.42 | 0.27 | 0.72 | 60.00 |
| sendToFirstChunkMs | 0.29 | 0.45 | 0.32 | 1.80 | 60.00 |
| agentChunkToAppMs | 0.33 | 0.79 | 0.34 | 1.32 | 60.00 |
| sendToEndMs | 0.32 | 0.53 | 0.37 | 2.25 | 60.00 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60.00 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60.00 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.14 | 60.00 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.05 | 0.11 | 60.00 |
| sendToRelayMs | 0.32 | 0.79 | 0.35 | 7.73 | 60.00 |
| relayToAgentMs | -0.26 | 0.18 | -0.24 | 0.24 | 60.00 |
| sendToAgentMs | 0.06 | 0.12 | 0.20 | 7.80 | 60.00 |
| sendToAckMs | 0.22 | 0.60 | 0.65 | 15.55 | 60.00 |
| sendToFirstChunkMs | 0.27 | 7.32 | 0.90 | 15.59 | 60.00 |
| agentChunkToAppMs | 0.41 | 1.17 | 0.72 | 14.76 | 60.00 |
| sendToEndMs | 0.30 | 7.41 | 0.96 | 15.62 | 60.00 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.07 | 0.04 | 0.27 | 60.00 |
| agentDecryptMs | 0.02 | 0.05 | 0.03 | 0.16 | 60.00 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.12 | 60.00 |
| appDecryptMs | 0.02 | 0.05 | 0.03 | 0.07 | 60.00 |
| sendToAgentMs | 0.08 | 0.15 | 0.23 | 8.70 | 60.00 |
| sendToEchoMs | 0.22 | 0.43 | 0.57 | 15.34 | 60.00 |
| agentToAppMs | 0.28 | 0.73 | 0.56 | 14.89 | 60.00 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.08 | 60.00 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60.00 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.16 | 60.00 |
| sendToAgentMs | 0.06 | 0.14 | 0.08 | 0.24 | 60.00 |
| sendToEchoMs | 0.20 | 0.36 | 0.22 | 0.50 | 60.00 |
| agentToAppMs | 0.21 | 0.68 | 0.23 | 0.74 | 60.00 |

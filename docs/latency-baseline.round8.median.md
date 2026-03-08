# Yuanio 通信延迟基线报告（Round8 三次中值）

- 生成时间: 2026-03-03T14:42:15.617Z
- 聚合方式: median_of_3_runs
- 数据源: docs/latency-baseline.round8.run1.json, docs/latency-baseline.round8.run2.json, docs/latency-baseline.round8.run3.json

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.04 | 0.14 | 60.00 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.04 | 0.15 | 60.00 |
| appDecryptChunkMs | 0.03 | 0.07 | 0.04 | 0.08 | 60.00 |
| sendToRelayMs | -0.30 | 0.14 | -0.31 | 0.16 | 60.00 |
| relayToAgentMs | 0.39 | 0.90 | 0.38 | 0.91 | 60.00 |
| sendToAgentMs | 0.08 | 0.13 | 0.08 | 0.24 | 60.00 |
| sendToAckMs | 0.25 | 0.37 | 0.27 | 0.49 | 60.00 |
| sendToFirstChunkMs | 0.27 | 0.42 | 0.30 | 0.61 | 60.00 |
| agentChunkToAppMs | -0.19 | 0.25 | -0.20 | 0.29 | 60.00 |
| sendToEndMs | 0.30 | 0.47 | 0.34 | 0.68 | 60.00 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.08 | 60.00 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.06 | 60.00 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.06 | 0.19 | 60.00 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.05 | 0.13 | 60.00 |
| sendToRelayMs | -0.30 | 0.10 | -0.30 | 0.15 | 60.00 |
| relayToAgentMs | 0.39 | 0.83 | 0.39 | 0.93 | 60.00 |
| sendToAgentMs | 0.08 | 0.15 | 0.09 | 0.16 | 60.00 |
| sendToAckMs | 0.25 | 0.40 | 0.49 | 13.60 | 60.00 |
| sendToFirstChunkMs | 0.31 | 2.04 | 0.87 | 13.66 | 60.00 |
| agentChunkToAppMs | -0.14 | 1.55 | 0.35 | 12.84 | 60.00 |
| sendToEndMs | 0.35 | 2.07 | 0.91 | 17.66 | 60.00 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.10 | 0.04 | 0.17 | 60.00 |
| agentDecryptMs | 0.03 | 0.07 | 0.03 | 0.10 | 60.00 |
| agentEncodeMs | 0.03 | 0.06 | 0.04 | 0.12 | 60.00 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.18 | 60.00 |
| sendToAgentMs | 0.09 | 0.22 | 0.44 | 9.56 | 60.00 |
| sendToEchoMs | 0.25 | 1.63 | 0.93 | 17.17 | 60.00 |
| agentToAppMs | -0.25 | 0.24 | -0.05 | 10.87 | 60.00 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.03 | 0.19 | 60.00 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.06 | 60.00 |
| agentEncodeMs | 0.03 | 0.04 | 0.04 | 0.05 | 60.00 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60.00 |
| sendToAgentMs | 0.06 | 0.11 | 0.08 | 0.19 | 60.00 |
| sendToEchoMs | 0.18 | 0.29 | 0.23 | 0.38 | 60.00 |
| agentToAppMs | -0.26 | 0.22 | -0.24 | 0.29 | 60.00 |

# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:37:28.621Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -8.12 ms (RTT 0.41 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.10 / p95=10.81 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.10 / p95=10.86 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 36.70 |
| pair/join | 24.01 |
| derive key (agent) | 1.17 |
| derive key (app) | 0.42 |
| socket connect (agent) | 5.78 |
| socket connect (app) | 8.69 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.14 | 0.05 | 0.19 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60 |
| agentEncodeChunkMs | 0.04 | 0.10 | 0.04 | 0.19 | 60 |
| appDecryptChunkMs | 0.04 | 0.13 | 0.05 | 0.19 | 60 |
| sendToRelayMs | 0.13 | 0.60 | 0.12 | 0.65 | 60 |
| relayToAgentMs | -0.03 | 0.42 | -0.04 | 0.46 | 60 |
| sendToAgentMs | 0.07 | 0.14 | 0.08 | 0.22 | 60 |
| sendToAckMs | 0.23 | 0.42 | 0.25 | 0.50 | 60 |
| sendToFirstChunkMs | 0.27 | 0.49 | 0.32 | 1.80 | 60 |
| agentChunkToAppMs | 0.33 | 0.79 | 0.34 | 1.32 | 60 |
| sendToEndMs | 0.31 | 0.64 | 0.39 | 2.25 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.06 | 60 |
| agentEncodeChunkMs | 0.05 | 0.06 | 0.05 | 0.07 | 60 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.07 | 1.44 | 60 |
| sendToRelayMs | 0.10 | 0.56 | 0.34 | 15.28 | 60 |
| relayToAgentMs | -0.01 | 0.42 | -0.03 | 0.44 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.32 | 15.32 | 60 |
| sendToAckMs | 0.22 | 0.64 | 0.71 | 15.55 | 60 |
| sendToFirstChunkMs | 0.26 | 7.38 | 0.90 | 15.59 | 60 |
| agentChunkToAppMs | 0.41 | 1.17 | 0.72 | 8.22 | 60 |
| sendToEndMs | 0.30 | 7.44 | 0.96 | 15.62 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.27 | 60 |
| agentDecryptMs | 0.02 | 0.05 | 0.03 | 0.16 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| appDecryptMs | 0.02 | 0.05 | 0.03 | 0.06 | 60 |
| sendToAgentMs | 0.08 | 0.15 | 0.11 | 1.51 | 60 |
| sendToEchoMs | 0.22 | 0.43 | 0.51 | 15.57 | 60 |
| agentToAppMs | 0.28 | 0.73 | 0.52 | 15.18 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.05 | 1.02 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.08 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.15 | 60 |
| sendToAgentMs | 0.06 | 0.17 | 0.08 | 0.30 | 60 |
| sendToEchoMs | 0.20 | 0.31 | 0.22 | 0.66 | 60 |
| agentToAppMs | 0.21 | 0.68 | 0.23 | 0.74 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

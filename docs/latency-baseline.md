# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-04T11:23:42.831Z
- Server: http://127.0.0.1:3200
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: 0.43 ms (RTT 0.43 ms, samples=7)
- Relay Event Loop Lag(开始): p50=13.20 / p95=13.20 / max=13.20 ms
- Relay Event Loop Lag(结束): p50=9.27 / p95=24.00 / max=24.37 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 38.93 |
| pair/join | 22.88 |
| derive key (agent) | 0.60 |
| derive key (app) | 0.19 |
| socket connect (agent) | 8.80 |
| socket connect (app) | 9.15 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.09 | 0.19 | 0.10 | 0.23 | 60 |
| agentDecryptMs | 0.11 | 0.25 | 0.14 | 0.57 | 60 |
| agentEncodeChunkMs | 0.11 | 0.26 | 0.12 | 0.28 | 60 |
| appDecryptChunkMs | 0.09 | 0.22 | 0.12 | 0.28 | 60 |
| sendToRelayMs | 0.61 | 1.08 | 0.63 | 1.19 | 60 |
| relayToAgentMs | 14.68 | 21.88 | 14.82 | 23.00 | 60 |
| sendToAgentMs | 15.32 | 22.26 | 15.45 | 23.64 | 60 |
| sendToAckMs | 41.86 | 54.69 | 40.32 | 56.31 | 60 |
| sendToFirstChunkMs | 41.93 | 54.73 | 40.40 | 56.37 | 60 |
| agentChunkToAppMs | 21.80 | 38.66 | 24.36 | 40.87 | 60 |
| sendToEndMs | 42.03 | 54.82 | 40.49 | 56.47 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.07 | 0.16 | 0.08 | 0.23 | 60 |
| agentDecryptMs | 0.09 | 0.24 | 0.11 | 0.32 | 60 |
| agentEncodeChunkMs | 0.10 | 0.29 | 0.13 | 0.59 | 60 |
| appDecryptChunkMs | 0.11 | 0.21 | 0.13 | 0.46 | 60 |
| sendToRelayMs | 0.79 | 7.74 | 2.14 | 16.25 | 60 |
| relayToAgentMs | 14.58 | 16.86 | 13.67 | 30.63 | 60 |
| sendToAgentMs | 15.39 | 25.04 | 15.81 | 31.25 | 60 |
| sendToAckMs | 31.51 | 61.46 | 38.44 | 62.62 | 60 |
| sendToFirstChunkMs | 31.60 | 61.51 | 38.55 | 62.69 | 60 |
| agentChunkToAppMs | 15.53 | 37.72 | 22.16 | 46.19 | 60 |
| sendToEndMs | 31.67 | 61.59 | 38.65 | 63.07 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.04 | 0.09 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.06 | 1.44 | 60 |
| agentEncodeMs | 0.03 | 0.08 | 0.04 | 0.15 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.19 | 60 |
| sendToAgentMs | 0.18 | 0.26 | 0.18 | 0.36 | 60 |
| sendToEchoMs | 0.42 | 0.76 | 0.47 | 1.98 | 60 |
| agentToAppMs | -0.14 | 0.33 | -0.11 | 0.53 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.07 | 60 |
| agentEncodeMs | 0.04 | 0.06 | 0.04 | 0.08 | 60 |
| appDecryptMs | 0.04 | 0.05 | 0.04 | 0.05 | 60 |
| sendToAgentMs | 0.12 | 0.17 | 0.15 | 1.65 | 60 |
| sendToEchoMs | 0.56 | 0.71 | 0.59 | 2.17 | 60 |
| agentToAppMs | 0.03 | 0.49 | 0.04 | 0.57 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

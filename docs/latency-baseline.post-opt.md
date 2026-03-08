# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T12:51:42.608Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 否
- Relay 时钟偏移估计: -18.24 ms (RTT 0.43 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.56 / p95=11.09 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.57 / p95=11.22 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 33.07 |
| pair/join | 22.04 |
| derive key (agent) | 0.59 |
| derive key (app) | 0.23 |
| socket connect (agent) | 4.15 |
| socket connect (app) | 8.16 |

## 场景: text-small

- Warmup: 5
- Iterations: 20
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.09 | 0.06 | 0.09 | 20 |
| agentDecryptMs | 0.04 | 0.06 | 0.04 | 0.06 | 20 |
| agentEncodeChunkMs | 0.05 | 0.10 | 0.06 | 0.20 | 20 |
| appDecryptChunkMs | 0.05 | 0.08 | 0.05 | 0.09 | 20 |
| sendToRelayMs | -0.19 | 0.23 | -0.16 | 0.28 | 20 |
| relayToAgentMs | 0.33 | 0.65 | 0.31 | 0.73 | 20 |
| sendToAgentMs | 0.13 | 0.22 | 0.15 | 0.23 | 20 |
| sendToAckMs | 0.47 | 0.83 | 0.56 | 2.45 | 20 |
| sendToFirstChunkMs | 0.58 | 0.87 | 0.64 | 2.52 | 20 |
| agentChunkToAppMs | -0.02 | 0.54 | 0.05 | 1.94 | 20 |
| sendToEndMs | 0.63 | 0.95 | 0.71 | 2.61 | 20 |

## 场景: text-large

- Warmup: 5
- Iterations: 20
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.06 | 0.07 | 0.06 | 0.07 | 20 |
| agentDecryptMs | 0.04 | 0.06 | 0.04 | 0.08 | 20 |
| agentEncodeChunkMs | 0.08 | 0.12 | 0.08 | 0.12 | 20 |
| appDecryptChunkMs | 0.08 | 0.12 | 0.08 | 0.15 | 20 |
| sendToRelayMs | -0.12 | 0.29 | -0.10 | 0.35 | 20 |
| relayToAgentMs | 0.32 | 0.49 | 0.26 | 0.66 | 20 |
| sendToAgentMs | 0.14 | 0.23 | 0.16 | 0.24 | 20 |
| sendToAckMs | 0.46 | 0.62 | 0.48 | 0.63 | 20 |
| sendToFirstChunkMs | 0.63 | 0.80 | 0.61 | 0.81 | 20 |
| agentChunkToAppMs | 0.04 | 0.29 | -0.05 | 0.30 | 20 |
| sendToEndMs | 0.70 | 0.88 | 0.68 | 0.94 | 20 |

## 场景: binary-small

- Warmup: 5
- Iterations: 20
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.06 | 0.08 | 0.06 | 0.09 | 20 |
| agentDecryptMs | 0.05 | 0.07 | 0.05 | 0.08 | 20 |
| agentEncodeMs | 0.05 | 0.09 | 0.06 | 0.12 | 20 |
| appDecryptMs | 0.04 | 0.18 | 0.15 | 2.05 | 20 |
| sendToAgentMs | 0.28 | 10.17 | 1.35 | 12.18 | 20 |
| sendToEchoMs | 0.60 | 10.79 | 2.21 | 12.54 | 20 |
| agentToAppMs | 0.06 | 1.00 | 0.51 | 10.13 | 20 |

## 场景: binary-large

- Warmup: 5
- Iterations: 20
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.06 | 0.05 | 0.06 | 20 |
| agentDecryptMs | 0.04 | 0.06 | 0.04 | 0.06 | 20 |
| agentEncodeMs | 0.06 | 0.09 | 0.06 | 0.10 | 20 |
| appDecryptMs | 0.06 | 0.09 | 0.07 | 0.19 | 20 |
| sendToAgentMs | 0.19 | 0.35 | 0.22 | 0.40 | 20 |
| sendToEchoMs | 0.54 | 0.73 | 0.57 | 0.84 | 20 |
| agentToAppMs | -0.14 | 0.42 | -0.12 | 0.44 | 20 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

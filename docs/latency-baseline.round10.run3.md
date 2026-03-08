# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:47:53.070Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -8.86 ms (RTT 0.31 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.47 / p95=11.17 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.50 / p95=11.27 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 35.33 |
| pair/join | 26.72 |
| derive key (agent) | 0.96 |
| derive key (app) | 0.42 |
| socket connect (agent) | 5.46 |
| socket connect (app) | 10.36 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.04 | 0.15 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.09 | 60 |
| agentEncodeChunkMs | 0.04 | 0.05 | 0.04 | 0.07 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.03 | 0.09 | 60 |
| sendToRelayMs | 0.04 | 0.45 | 0.04 | 0.49 | 60 |
| relayToAgentMs | 0.03 | 0.47 | 0.03 | 0.50 | 60 |
| sendToAgentMs | 0.07 | 0.13 | 0.07 | 0.30 | 60 |
| sendToAckMs | 0.20 | 0.33 | 0.22 | 0.61 | 60 |
| sendToFirstChunkMs | 0.23 | 0.38 | 0.25 | 0.69 | 60 |
| agentChunkToAppMs | -0.05 | 0.37 | -0.07 | 0.53 | 60 |
| sendToEndMs | 0.27 | 0.44 | 0.29 | 0.75 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.17 | 60 |
| agentEncodeChunkMs | 0.07 | 0.12 | 0.09 | 1.60 | 60 |
| appDecryptChunkMs | 0.06 | 0.12 | 0.07 | 0.13 | 60 |
| sendToRelayMs | 0.03 | 0.47 | 0.01 | 0.49 | 60 |
| relayToAgentMs | 0.04 | 0.51 | 0.06 | 0.54 | 60 |
| sendToAgentMs | 0.06 | 0.13 | 0.07 | 0.14 | 60 |
| sendToAckMs | 0.23 | 0.47 | 0.41 | 7.58 | 60 |
| sendToFirstChunkMs | 0.31 | 7.66 | 1.02 | 15.64 | 60 |
| agentChunkToAppMs | 0.02 | 7.26 | 0.63 | 15.17 | 60 |
| sendToEndMs | 0.37 | 9.03 | 1.35 | 15.74 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.07 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.06 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.20 | 60 |
| appDecryptMs | 0.02 | 0.04 | 0.06 | 1.68 | 60 |
| sendToAgentMs | 0.08 | 0.15 | 0.23 | 8.63 | 60 |
| sendToEchoMs | 0.21 | 0.52 | 0.64 | 16.00 | 60 |
| agentToAppMs | -0.13 | 0.34 | 0.15 | 15.48 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.86 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.04 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.29 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.16 | 60 |
| sendToAgentMs | 0.06 | 0.13 | 0.07 | 0.17 | 60 |
| sendToEchoMs | 0.19 | 0.34 | 0.22 | 0.51 | 60 |
| agentToAppMs | -0.06 | 0.35 | -0.07 | 0.46 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

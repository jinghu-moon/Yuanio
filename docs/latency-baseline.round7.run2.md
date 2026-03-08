# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:36:04.834Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -23.64 ms (RTT 0.22 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.36 / p95=11.07 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.34 / p95=11.14 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 40.05 |
| pair/join | 23.98 |
| derive key (agent) | 0.98 |
| derive key (app) | 0.35 |
| socket connect (agent) | 4.64 |
| socket connect (app) | 7.69 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.07 | 0.04 | 0.09 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.11 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.23 | 60 |
| appDecryptChunkMs | 0.03 | 0.12 | 0.04 | 0.15 | 60 |
| sendToRelayMs | 0.29 | 0.75 | 0.32 | 0.96 | 60 |
| relayToAgentMs | -0.22 | 0.22 | -0.23 | 0.47 | 60 |
| sendToAgentMs | 0.08 | 0.13 | 0.09 | 0.52 | 60 |
| sendToAckMs | 0.25 | 0.38 | 0.27 | 0.72 | 60 |
| sendToFirstChunkMs | 0.29 | 0.43 | 0.32 | 1.29 | 60 |
| agentChunkToAppMs | 0.14 | 0.61 | 0.17 | 1.44 | 60 |
| sendToEndMs | 0.33 | 0.53 | 0.37 | 1.34 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.08 | 60 |
| agentEncodeChunkMs | 0.04 | 0.08 | 0.07 | 1.36 | 60 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.04 | 0.09 | 60 |
| sendToRelayMs | 0.32 | 0.79 | 0.44 | 7.73 | 60 |
| relayToAgentMs | -0.26 | 0.18 | -0.24 | 0.24 | 60 |
| sendToAgentMs | 0.06 | 0.12 | 0.20 | 7.80 | 60 |
| sendToAckMs | 0.21 | 0.60 | 0.62 | 14.99 | 60 |
| sendToFirstChunkMs | 0.27 | 1.98 | 0.81 | 15.05 | 60 |
| agentChunkToAppMs | 0.26 | 0.75 | 0.59 | 14.76 | 60 |
| sendToEndMs | 0.30 | 2.01 | 0.84 | 15.13 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.07 | 0.05 | 1.14 | 60 |
| agentDecryptMs | 0.02 | 0.06 | 0.03 | 0.17 | 60 |
| agentEncodeMs | 0.03 | 0.06 | 0.03 | 0.15 | 60 |
| appDecryptMs | 0.02 | 0.05 | 0.03 | 0.07 | 60 |
| sendToAgentMs | 0.08 | 0.17 | 0.23 | 8.70 | 60 |
| sendToEchoMs | 0.22 | 1.03 | 0.79 | 15.34 | 60 |
| agentToAppMs | 0.19 | 0.72 | 0.56 | 14.89 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.03 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.15 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.14 | 60 |
| appDecryptMs | 0.02 | 0.04 | 0.03 | 0.16 | 60 |
| sendToAgentMs | 0.06 | 0.14 | 0.07 | 0.22 | 60 |
| sendToEchoMs | 0.19 | 0.38 | 0.22 | 0.50 | 60 |
| agentToAppMs | 0.12 | 0.60 | 0.14 | 0.63 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

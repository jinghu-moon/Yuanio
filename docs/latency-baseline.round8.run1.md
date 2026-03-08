# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:40:22.051Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -8.90 ms (RTT 0.29 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.29 / p95=11.18 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.29 / p95=11.18 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 34.73 |
| pair/join | 27.16 |
| derive key (agent) | 0.76 |
| derive key (app) | 0.37 |
| socket connect (agent) | 3.82 |
| socket connect (app) | 9.18 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.09 | 0.04 | 0.15 | 60 |
| agentDecryptMs | 0.03 | 0.06 | 0.03 | 0.09 | 60 |
| agentEncodeChunkMs | 0.03 | 0.08 | 0.04 | 0.09 | 60 |
| appDecryptChunkMs | 0.03 | 0.09 | 0.04 | 0.13 | 60 |
| sendToRelayMs | -0.22 | 0.18 | -0.27 | 0.25 | 60 |
| relayToAgentMs | 0.35 | 0.81 | 0.37 | 0.85 | 60 |
| sendToAgentMs | 0.09 | 0.18 | 0.10 | 0.25 | 60 |
| sendToAckMs | 0.26 | 0.53 | 0.31 | 0.63 | 60 |
| sendToFirstChunkMs | 0.31 | 0.64 | 0.36 | 0.68 | 60 |
| agentChunkToAppMs | -0.19 | 0.32 | -0.19 | 0.44 | 60 |
| sendToEndMs | 0.36 | 0.74 | 0.41 | 0.79 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.06 | 1.95 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.10 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.05 | 0.08 | 60 |
| appDecryptChunkMs | 0.04 | 0.06 | 0.04 | 0.12 | 60 |
| sendToRelayMs | -0.19 | 0.23 | 0.06 | 9.11 | 60 |
| relayToAgentMs | 0.27 | 0.76 | 0.29 | 0.82 | 60 |
| sendToAgentMs | 0.07 | 0.20 | 0.36 | 9.08 | 60 |
| sendToAckMs | 0.23 | 0.91 | 0.81 | 17.48 | 60 |
| sendToFirstChunkMs | 0.30 | 1.01 | 0.87 | 17.57 | 60 |
| agentChunkToAppMs | -0.16 | 0.31 | 0.13 | 17.59 | 60 |
| sendToEndMs | 0.32 | 1.04 | 0.91 | 17.66 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.10 | 0.04 | 0.22 | 60 |
| agentDecryptMs | 0.03 | 0.07 | 0.03 | 0.15 | 60 |
| agentEncodeMs | 0.03 | 0.06 | 0.04 | 0.14 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.20 | 60 |
| sendToAgentMs | 0.10 | 0.21 | 0.56 | 19.32 | 60 |
| sendToEchoMs | 0.27 | 1.63 | 0.93 | 19.65 | 60 |
| agentToAppMs | -0.29 | 0.24 | -0.05 | 10.87 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.03 | 0.10 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.02 | 0.06 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.04 | 0.07 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| sendToAgentMs | 0.06 | 0.12 | 0.19 | 7.25 | 60 |
| sendToEchoMs | 0.18 | 0.72 | 0.36 | 7.53 | 60 |
| agentToAppMs | -0.26 | 0.22 | -0.22 | 0.79 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

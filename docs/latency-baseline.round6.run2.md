# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:17:36.386Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -0.12 ms (RTT 0.19 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.33 / p95=11.60 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.34 / p95=11.62 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 37.34 |
| pair/join | 24.16 |
| derive key (agent) | 0.93 |
| derive key (app) | 0.34 |
| socket connect (agent) | 4.33 |
| socket connect (app) | 7.61 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.12 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.14 | 60 |
| agentEncodeChunkMs | 0.04 | 0.05 | 0.04 | 0.07 | 60 |
| appDecryptChunkMs | 0.03 | 0.05 | 0.03 | 0.13 | 60 |
| sendToRelayMs | 0.56 | 0.97 | 0.54 | 1.05 | 60 |
| relayToAgentMs | -0.50 | -0.03 | -0.47 | 0.06 | 60 |
| sendToAgentMs | 0.07 | 0.12 | 0.08 | 0.23 | 60 |
| sendToAckMs | 0.23 | 0.35 | 0.24 | 0.52 | 60 |
| sendToFirstChunkMs | 0.25 | 0.38 | 0.27 | 0.58 | 60 |
| agentChunkToAppMs | -0.33 | 0.08 | -0.34 | 0.12 | 60 |
| sendToEndMs | 0.29 | 0.47 | 0.31 | 0.71 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.11 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.08 | 60 |
| appDecryptChunkMs | 0.04 | 0.12 | 0.07 | 1.24 | 60 |
| sendToRelayMs | 0.46 | 0.95 | 0.48 | 1.02 | 60 |
| relayToAgentMs | -0.41 | 0.04 | -0.42 | 0.06 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.07 | 0.13 | 60 |
| sendToAckMs | 0.21 | 0.30 | 0.46 | 7.91 | 60 |
| sendToFirstChunkMs | 0.26 | 0.75 | 0.64 | 8.09 | 60 |
| agentChunkToAppMs | -0.32 | 0.49 | 0.05 | 7.67 | 60 |
| sendToEndMs | 0.30 | 2.64 | 0.74 | 8.16 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.13 | 60 |
| agentDecryptMs | 0.02 | 0.05 | 0.04 | 1.01 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| appDecryptMs | 0.02 | 0.04 | 0.03 | 0.05 | 60 |
| sendToAgentMs | 0.08 | 0.20 | 0.24 | 8.88 | 60 |
| sendToEchoMs | 0.23 | 0.36 | 0.51 | 9.14 | 60 |
| agentToAppMs | -0.38 | 0.06 | -0.26 | 6.65 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.13 | 60 |
| agentEncodeMs | 0.04 | 0.06 | 0.04 | 0.14 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.06 | 1.54 | 60 |
| sendToAgentMs | 0.07 | 0.12 | 0.07 | 0.18 | 60 |
| sendToEchoMs | 0.20 | 0.33 | 0.22 | 0.64 | 60 |
| agentToAppMs | -0.33 | 0.11 | -0.32 | 0.40 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

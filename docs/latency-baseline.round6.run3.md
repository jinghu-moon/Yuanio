# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:19:02.445Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -0.22 ms (RTT 0.28 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.67 / p95=11.49 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.71 / p95=11.64 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 32.96 |
| pair/join | 22.03 |
| derive key (agent) | 0.59 |
| derive key (app) | 0.24 |
| socket connect (agent) | 3.66 |
| socket connect (app) | 8.36 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.05 | 0.04 | 0.20 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.05 | 0.27 | 60 |
| appDecryptChunkMs | 0.04 | 0.08 | 0.04 | 0.18 | 60 |
| sendToRelayMs | -0.42 | 0.02 | -0.40 | 0.08 | 60 |
| relayToAgentMs | 0.51 | 0.92 | 0.48 | 0.96 | 60 |
| sendToAgentMs | 0.08 | 0.12 | 0.08 | 0.17 | 60 |
| sendToAckMs | 0.26 | 0.37 | 0.27 | 0.47 | 60 |
| sendToFirstChunkMs | 0.30 | 0.44 | 0.31 | 0.65 | 60 |
| agentChunkToAppMs | -0.26 | 0.18 | -0.27 | 0.27 | 60 |
| sendToEndMs | 0.33 | 0.53 | 0.35 | 0.71 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.09 | 0.06 | 0.15 | 60 |
| agentDecryptMs | 0.05 | 0.09 | 0.05 | 0.10 | 60 |
| agentEncodeChunkMs | 0.08 | 0.12 | 0.09 | 0.23 | 60 |
| appDecryptChunkMs | 0.08 | 0.13 | 0.08 | 0.14 | 60 |
| sendToRelayMs | -0.32 | 0.09 | -0.18 | 9.63 | 60 |
| relayToAgentMs | 0.48 | 0.96 | 0.52 | 2.79 | 60 |
| sendToAgentMs | 0.14 | 0.20 | 0.34 | 10.21 | 60 |
| sendToAckMs | 0.44 | 2.76 | 1.10 | 18.13 | 60 |
| sendToFirstChunkMs | 0.54 | 10.71 | 1.70 | 20.98 | 60 |
| agentChunkToAppMs | -0.19 | 9.99 | 0.79 | 20.36 | 60 |
| sendToEndMs | 0.60 | 10.79 | 1.76 | 21.10 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.06 | 0.08 | 0.06 | 0.11 | 60 |
| agentDecryptMs | 0.05 | 0.07 | 0.06 | 0.10 | 60 |
| agentEncodeMs | 0.06 | 0.09 | 0.06 | 0.11 | 60 |
| appDecryptMs | 0.05 | 0.07 | 0.05 | 0.08 | 60 |
| sendToAgentMs | 0.18 | 0.30 | 0.64 | 17.36 | 60 |
| sendToEchoMs | 0.48 | 0.77 | 1.01 | 20.12 | 60 |
| agentToAppMs | -0.23 | 0.24 | -0.16 | 1.93 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.08 | 0.04 | 0.19 | 60 |
| agentDecryptMs | 0.04 | 0.05 | 0.05 | 1.00 | 60 |
| agentEncodeMs | 0.05 | 0.07 | 0.05 | 0.09 | 60 |
| appDecryptMs | 0.04 | 0.06 | 0.04 | 0.07 | 60 |
| sendToAgentMs | 0.13 | 0.19 | 0.13 | 0.33 | 60 |
| sendToEchoMs | 0.35 | 0.48 | 0.35 | 1.32 | 60 |
| agentToAppMs | -0.30 | 0.16 | -0.29 | 0.22 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

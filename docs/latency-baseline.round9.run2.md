# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:43:32.253Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -14.60 ms (RTT 0.24 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.39 / p95=15.95 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.39 / p95=15.95 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 32.72 |
| pair/join | 22.34 |
| derive key (agent) | 0.67 |
| derive key (app) | 0.41 |
| socket connect (agent) | 5.13 |
| socket connect (app) | 8.60 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.05 | 0.04 | 0.09 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.04 | 0.05 | 0.04 | 0.06 | 60 |
| appDecryptChunkMs | 0.03 | 0.07 | 0.04 | 0.09 | 60 |
| sendToRelayMs | 0.21 | 0.65 | 0.22 | 0.70 | 60 |
| relayToAgentMs | -0.13 | 0.30 | -0.15 | 0.34 | 60 |
| sendToAgentMs | 0.08 | 0.12 | 0.08 | 0.13 | 60 |
| sendToAckMs | 0.23 | 0.33 | 0.24 | 0.36 | 60 |
| sendToFirstChunkMs | 0.26 | 0.37 | 0.27 | 0.43 | 60 |
| agentChunkToAppMs | -0.07 | 0.38 | -0.05 | 0.49 | 60 |
| sendToEndMs | 0.29 | 0.43 | 0.31 | 0.51 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.12 | 60 |
| appDecryptChunkMs | 0.04 | 0.09 | 0.07 | 1.21 | 60 |
| sendToRelayMs | 0.26 | 0.63 | 0.23 | 0.72 | 60 |
| relayToAgentMs | -0.17 | 0.29 | -0.16 | 0.36 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.07 | 0.15 | 60 |
| sendToAckMs | 0.21 | 0.78 | 0.71 | 14.64 | 60 |
| sendToFirstChunkMs | 0.26 | 0.82 | 0.76 | 14.70 | 60 |
| agentChunkToAppMs | -0.08 | 0.78 | 0.42 | 14.01 | 60 |
| sendToEndMs | 0.30 | 1.75 | 0.81 | 14.77 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.05 | 0.97 | 60 |
| agentDecryptMs | 0.02 | 0.05 | 0.03 | 0.14 | 60 |
| agentEncodeMs | 0.03 | 0.06 | 0.04 | 0.13 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.07 | 60 |
| sendToAgentMs | 0.09 | 0.19 | 0.27 | 7.64 | 60 |
| sendToEchoMs | 0.24 | 3.55 | 0.70 | 8.84 | 60 |
| agentToAppMs | -0.00 | 0.42 | 0.27 | 9.01 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.03 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.04 | 0.09 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| sendToAgentMs | 0.06 | 0.10 | 0.09 | 1.20 | 60 |
| sendToEchoMs | 0.19 | 0.28 | 0.22 | 1.39 | 60 |
| agentToAppMs | -0.08 | 0.39 | -0.08 | 0.42 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

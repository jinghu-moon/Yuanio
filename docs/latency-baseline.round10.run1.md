# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:46:14.432Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -24.05 ms (RTT 0.26 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.52 / p95=11.61 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.53 / p95=11.63 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 40.34 |
| pair/join | 22.29 |
| derive key (agent) | 0.80 |
| derive key (app) | 0.30 |
| socket connect (agent) | 5.21 |
| socket connect (app) | 10.30 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.05 | 0.04 | 0.10 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.04 | 0.14 | 60 |
| appDecryptChunkMs | 0.03 | 0.07 | 0.04 | 0.30 | 60 |
| sendToRelayMs | 0.49 | 0.92 | 0.50 | 0.97 | 60 |
| relayToAgentMs | -0.42 | -0.02 | -0.43 | 0.10 | 60 |
| sendToAgentMs | 0.07 | 0.11 | 0.07 | 0.14 | 60 |
| sendToAckMs | 0.23 | 0.34 | 0.24 | 0.42 | 60 |
| sendToFirstChunkMs | 0.25 | 0.38 | 0.27 | 0.61 | 60 |
| agentChunkToAppMs | 0.20 | 0.61 | 0.20 | 0.69 | 60 |
| sendToEndMs | 0.30 | 0.47 | 0.32 | 0.66 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.07 | 60 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.18 | 60 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.05 | 0.13 | 60 |
| sendToRelayMs | 0.48 | 0.97 | 0.48 | 0.99 | 60 |
| relayToAgentMs | -0.36 | 0.04 | -0.42 | 0.07 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.06 | 0.20 | 60 |
| sendToAckMs | 0.20 | 0.44 | 0.46 | 14.66 | 60 |
| sendToFirstChunkMs | 0.26 | 0.76 | 0.65 | 14.70 | 60 |
| agentChunkToAppMs | 0.25 | 0.75 | 0.64 | 15.02 | 60 |
| sendToEndMs | 0.29 | 0.80 | 0.69 | 14.76 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.12 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.07 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.10 | 60 |
| appDecryptMs | 0.02 | 0.05 | 0.03 | 0.17 | 60 |
| sendToAgentMs | 0.07 | 0.14 | 0.21 | 7.61 | 60 |
| sendToEchoMs | 0.20 | 0.87 | 0.75 | 15.96 | 60 |
| agentToAppMs | 0.23 | 0.71 | 0.62 | 16.14 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.06 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.07 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.05 | 1.27 | 60 |
| sendToAgentMs | 0.07 | 0.12 | 0.20 | 7.67 | 60 |
| sendToEchoMs | 0.20 | 0.37 | 0.36 | 7.98 | 60 |
| agentToAppMs | 0.18 | 0.61 | 0.20 | 1.44 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

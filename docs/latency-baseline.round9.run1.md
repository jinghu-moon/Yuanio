# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:43:23.495Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -12.78 ms (RTT 0.24 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.32 / p95=11.19 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.31 / p95=12.34 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 36.38 |
| pair/join | 22.97 |
| derive key (agent) | 0.93 |
| derive key (app) | 0.35 |
| socket connect (agent) | 6.04 |
| socket connect (app) | 14.31 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.05 | 0.04 | 0.18 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.04 | 0.05 | 0.04 | 0.16 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.13 | 60 |
| sendToRelayMs | -0.13 | 0.29 | -0.13 | 0.35 | 60 |
| relayToAgentMs | 0.21 | 0.65 | 0.20 | 0.68 | 60 |
| sendToAgentMs | 0.07 | 0.10 | 0.07 | 0.12 | 60 |
| sendToAckMs | 0.23 | 0.29 | 0.23 | 0.35 | 60 |
| sendToFirstChunkMs | 0.26 | 0.35 | 0.27 | 0.38 | 60 |
| agentChunkToAppMs | 0.43 | 0.86 | 0.41 | 0.89 | 60 |
| sendToEndMs | 0.30 | 0.41 | 0.30 | 0.49 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.03 | 0.09 | 0.03 | 0.18 | 60 |
| agentEncodeChunkMs | 0.05 | 0.09 | 0.05 | 0.18 | 60 |
| appDecryptChunkMs | 0.04 | 0.09 | 0.05 | 0.14 | 60 |
| sendToRelayMs | -0.14 | 0.26 | 0.00 | 6.81 | 60 |
| relayToAgentMs | 0.23 | 0.70 | 0.26 | 1.84 | 60 |
| sendToAgentMs | 0.07 | 0.23 | 0.26 | 7.55 | 60 |
| sendToAckMs | 0.23 | 2.96 | 0.81 | 15.46 | 60 |
| sendToFirstChunkMs | 0.30 | 3.04 | 0.88 | 15.52 | 60 |
| agentChunkToAppMs | 0.52 | 0.93 | 0.83 | 15.47 | 60 |
| sendToEndMs | 0.33 | 7.79 | 1.05 | 15.60 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.08 | 0.04 | 0.11 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentEncodeMs | 0.04 | 0.08 | 0.04 | 0.19 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.12 | 60 |
| sendToAgentMs | 0.11 | 0.23 | 0.24 | 7.46 | 60 |
| sendToEchoMs | 0.30 | 0.58 | 0.56 | 8.09 | 60 |
| agentToAppMs | 0.46 | 0.88 | 0.55 | 7.71 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.05 | 1.53 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.02 | 0.05 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.05 | 0.76 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| sendToAgentMs | 0.06 | 0.14 | 0.08 | 0.19 | 60 |
| sendToEchoMs | 0.19 | 0.37 | 0.22 | 0.98 | 60 |
| agentToAppMs | 0.38 | 0.82 | 0.40 | 1.05 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

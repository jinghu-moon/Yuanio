# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:35:53.039Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -21.62 ms (RTT 0.50 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.33 / p95=10.99 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.35 / p95=11.04 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 35.54 |
| pair/join | 22.55 |
| derive key (agent) | 1.35 |
| derive key (app) | 0.85 |
| socket connect (agent) | 4.54 |
| socket connect (app) | 7.40 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.04 | 0.11 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.13 | 60 |
| appDecryptChunkMs | 0.03 | 0.07 | 0.04 | 0.13 | 60 |
| sendToRelayMs | 0.27 | 0.83 | 0.36 | 2.64 | 60 |
| relayToAgentMs | -0.20 | 0.16 | -0.24 | 0.23 | 60 |
| sendToAgentMs | 0.08 | 0.16 | 0.11 | 1.95 | 60 |
| sendToAckMs | 0.25 | 0.42 | 0.29 | 2.15 | 60 |
| sendToFirstChunkMs | 0.29 | 0.45 | 0.33 | 2.25 | 60 |
| agentChunkToAppMs | 0.64 | 1.06 | 0.64 | 1.22 | 60 |
| sendToEndMs | 0.32 | 0.51 | 0.36 | 2.29 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.06 | 1.76 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.14 | 60 |
| appDecryptChunkMs | 0.05 | 0.08 | 0.05 | 0.11 | 60 |
| sendToRelayMs | 0.37 | 0.80 | 0.35 | 0.82 | 60 |
| relayToAgentMs | -0.28 | 0.14 | -0.28 | 0.21 | 60 |
| sendToAgentMs | 0.07 | 0.12 | 0.08 | 0.19 | 60 |
| sendToAckMs | 0.24 | 0.46 | 0.65 | 16.23 | 60 |
| sendToFirstChunkMs | 0.29 | 7.32 | 0.96 | 16.29 | 60 |
| agentChunkToAppMs | 0.59 | 7.81 | 1.26 | 16.80 | 60 |
| sendToEndMs | 0.32 | 7.41 | 1.00 | 16.36 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.08 | 0.04 | 0.17 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.12 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.12 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| sendToAgentMs | 0.09 | 0.15 | 0.30 | 12.28 | 60 |
| sendToEchoMs | 0.24 | 0.41 | 0.57 | 12.50 | 60 |
| agentToAppMs | 0.54 | 1.01 | 0.66 | 7.71 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.09 | 1.75 | 60 |
| sendToAgentMs | 0.07 | 0.13 | 0.08 | 0.24 | 60 |
| sendToEchoMs | 0.21 | 0.36 | 0.23 | 0.46 | 60 |
| agentToAppMs | 0.64 | 1.04 | 0.60 | 1.12 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T13:02:02.577Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 否
- Relay 时钟偏移估计: -4.80 ms (RTT 0.40 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.37 / p95=12.07 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.36 / p95=12.07 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 38.72 |
| pair/join | 23.89 |
| derive key (agent) | 0.55 |
| derive key (app) | 0.25 |
| socket connect (agent) | 4.47 |
| socket connect (app) | 8.93 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.09 | 0.05 | 0.09 | 60 |
| agentDecryptMs | 0.04 | 0.06 | 0.05 | 0.85 | 60 |
| agentEncodeChunkMs | 0.04 | 0.08 | 0.05 | 0.10 | 60 |
| appDecryptChunkMs | 0.04 | 0.09 | 0.05 | 0.09 | 60 |
| sendToRelayMs | 0.18 | 0.59 | 0.34 | 11.43 | 60 |
| relayToAgentMs | -0.05 | 0.41 | -0.02 | 0.43 | 60 |
| sendToAgentMs | 0.12 | 0.21 | 0.32 | 11.20 | 60 |
| sendToAckMs | 0.38 | 0.59 | 0.60 | 12.46 | 60 |
| sendToFirstChunkMs | 0.45 | 0.71 | 0.99 | 23.08 | 60 |
| agentChunkToAppMs | -0.07 | 0.37 | 0.22 | 10.46 | 60 |
| sendToEndMs | 0.50 | 0.80 | 1.04 | 23.17 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.10 | 0.08 | 1.36 | 60 |
| agentDecryptMs | 0.04 | 0.07 | 0.05 | 0.15 | 60 |
| agentEncodeChunkMs | 0.07 | 0.12 | 0.07 | 0.13 | 60 |
| appDecryptChunkMs | 0.07 | 0.11 | 0.07 | 0.13 | 60 |
| sendToRelayMs | 0.23 | 0.66 | 0.20 | 0.69 | 60 |
| relayToAgentMs | -0.06 | 0.38 | -0.05 | 0.43 | 60 |
| sendToAgentMs | 0.14 | 0.19 | 0.14 | 0.23 | 60 |
| sendToAckMs | 0.44 | 0.61 | 1.21 | 28.96 | 60 |
| sendToFirstChunkMs | 0.54 | 1.30 | 1.50 | 29.08 | 60 |
| agentChunkToAppMs | 0.03 | 1.06 | 0.96 | 28.26 | 60 |
| sendToEndMs | 0.59 | 1.38 | 1.56 | 29.15 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.05 | 0.08 | 0.05 | 0.10 | 60 |
| agentDecryptMs | 0.04 | 0.07 | 0.04 | 0.11 | 60 |
| agentEncodeMs | 0.04 | 0.09 | 0.05 | 0.18 | 60 |
| appDecryptMs | 0.04 | 0.07 | 0.04 | 0.08 | 60 |
| sendToAgentMs | 0.17 | 0.24 | 0.64 | 18.13 | 60 |
| sendToEchoMs | 0.44 | 0.69 | 0.93 | 18.63 | 60 |
| agentToAppMs | -0.13 | 0.30 | -0.11 | 0.90 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.07 | 0.05 | 0.10 | 60 |
| agentDecryptMs | 0.03 | 0.06 | 0.04 | 0.10 | 60 |
| agentEncodeMs | 0.05 | 0.10 | 0.07 | 0.98 | 60 |
| appDecryptMs | 0.04 | 0.06 | 0.04 | 0.11 | 60 |
| sendToAgentMs | 0.16 | 0.24 | 0.17 | 0.28 | 60 |
| sendToEchoMs | 0.43 | 0.59 | 0.44 | 1.35 | 60 |
| agentToAppMs | -0.09 | 0.37 | -0.12 | 1.30 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

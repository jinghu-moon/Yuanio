# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:46:27.580Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -25.74 ms (RTT 0.47 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.49 / p95=11.57 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.50 / p95=11.57 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 28.03 |
| pair/join | 18.10 |
| derive key (agent) | 0.60 |
| derive key (app) | 0.24 |
| socket connect (agent) | 4.12 |
| socket connect (app) | 5.45 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.04 | 0.07 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.15 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.11 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.18 | 60 |
| sendToRelayMs | -0.18 | 0.31 | -0.17 | 0.33 | 60 |
| relayToAgentMs | 0.25 | 0.71 | 0.25 | 0.81 | 60 |
| sendToAgentMs | 0.07 | 0.11 | 0.08 | 0.20 | 60 |
| sendToAckMs | 0.23 | 0.33 | 0.24 | 0.43 | 60 |
| sendToFirstChunkMs | 0.27 | 0.36 | 0.27 | 0.45 | 60 |
| agentChunkToAppMs | 0.21 | 0.73 | 0.23 | 0.77 | 60 |
| sendToEndMs | 0.31 | 0.48 | 0.33 | 1.18 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.27 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.06 | 1.73 | 60 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.06 | 0.26 | 60 |
| appDecryptChunkMs | 0.05 | 0.07 | 0.05 | 0.08 | 60 |
| sendToRelayMs | -0.22 | 0.23 | -0.22 | 0.27 | 60 |
| relayToAgentMs | 0.30 | 0.70 | 0.29 | 0.72 | 60 |
| sendToAgentMs | 0.07 | 0.10 | 0.07 | 0.14 | 60 |
| sendToAckMs | 0.23 | 0.40 | 0.45 | 11.38 | 60 |
| sendToFirstChunkMs | 0.28 | 0.57 | 0.51 | 11.45 | 60 |
| agentChunkToAppMs | 0.31 | 0.78 | 0.48 | 11.13 | 60 |
| sendToEndMs | 0.32 | 2.17 | 0.69 | 11.52 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.04 | 0.24 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| appDecryptMs | 0.03 | 0.09 | 0.04 | 0.14 | 60 |
| sendToAgentMs | 0.09 | 0.15 | 0.10 | 0.17 | 60 |
| sendToEchoMs | 0.25 | 0.78 | 0.74 | 13.27 | 60 |
| agentToAppMs | 0.19 | 1.03 | 0.63 | 12.69 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.04 | 0.82 | 60 |
| agentEncodeMs | 0.04 | 0.07 | 0.04 | 0.16 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.32 | 60 |
| sendToAgentMs | 0.07 | 0.13 | 0.08 | 0.16 | 60 |
| sendToEchoMs | 0.22 | 0.56 | 0.40 | 7.48 | 60 |
| agentToAppMs | 0.23 | 0.69 | 0.34 | 7.02 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

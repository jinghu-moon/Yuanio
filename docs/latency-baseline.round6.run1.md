# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:17:35.669Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -0.10 ms (RTT 0.26 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.30 / p95=11.55 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.33 / p95=11.59 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 36.32 |
| pair/join | 24.20 |
| derive key (agent) | 0.61 |
| derive key (app) | 0.22 |
| socket connect (agent) | 3.85 |
| socket connect (app) | 7.98 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.07 | 0.04 | 0.18 | 60 |
| agentDecryptMs | 0.03 | 0.07 | 0.04 | 0.17 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.09 | 60 |
| appDecryptChunkMs | 0.03 | 0.09 | 0.04 | 0.23 | 60 |
| sendToRelayMs | -0.21 | 0.26 | -0.18 | 0.34 | 60 |
| relayToAgentMs | 0.26 | 0.70 | 0.26 | 0.73 | 60 |
| sendToAgentMs | 0.07 | 0.14 | 0.08 | 0.28 | 60 |
| sendToAckMs | 0.23 | 0.44 | 0.26 | 0.67 | 60 |
| sendToFirstChunkMs | 0.27 | 0.45 | 0.30 | 0.68 | 60 |
| agentChunkToAppMs | 0.34 | 0.73 | 0.31 | 0.79 | 60 |
| sendToEndMs | 0.30 | 0.55 | 0.36 | 1.38 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.05 | 1.33 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.04 | 60 |
| agentEncodeChunkMs | 0.05 | 0.07 | 0.05 | 0.11 | 60 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.05 | 0.30 | 60 |
| sendToRelayMs | -0.17 | 0.24 | -0.19 | 0.28 | 60 |
| relayToAgentMs | 0.26 | 0.69 | 0.26 | 0.73 | 60 |
| sendToAgentMs | 0.06 | 0.12 | 0.07 | 0.20 | 60 |
| sendToAckMs | 0.20 | 0.33 | 0.35 | 8.01 | 60 |
| sendToFirstChunkMs | 0.25 | 0.41 | 0.54 | 9.13 | 60 |
| agentChunkToAppMs | 0.33 | 0.80 | 0.60 | 9.40 | 60 |
| sendToEndMs | 0.29 | 0.44 | 0.58 | 9.21 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.16 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.07 | 60 |
| appDecryptMs | 0.02 | 0.06 | 0.03 | 0.38 | 60 |
| sendToAgentMs | 0.07 | 0.15 | 0.33 | 14.91 | 60 |
| sendToEchoMs | 0.20 | 0.36 | 0.72 | 21.95 | 60 |
| agentToAppMs | 0.24 | 0.76 | 0.50 | 8.43 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.09 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.07 | 60 |
| agentEncodeMs | 0.03 | 0.07 | 0.05 | 0.72 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.05 | 1.30 | 60 |
| sendToAgentMs | 0.07 | 0.18 | 0.23 | 8.92 | 60 |
| sendToEchoMs | 0.20 | 0.90 | 0.70 | 11.27 | 60 |
| agentToAppMs | 0.27 | 0.88 | 0.60 | 9.55 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:05:12.275Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -20.87 ms (RTT 0.30 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.33 / p95=10.94 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.28 / p95=10.94 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 36.83 |
| pair/join | 25.68 |
| derive key (agent) | 0.85 |
| derive key (app) | 0.43 |
| socket connect (agent) | 4.98 |
| socket connect (app) | 9.03 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.16 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.14 | 60 |
| agentEncodeChunkMs | 0.03 | 0.05 | 0.04 | 0.18 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.03 | 0.08 | 60 |
| sendToRelayMs | 0.52 | 0.96 | 0.49 | 0.98 | 60 |
| relayToAgentMs | -0.45 | 0.03 | -0.42 | 0.09 | 60 |
| sendToAgentMs | 0.07 | 0.10 | 0.07 | 0.18 | 60 |
| sendToAckMs | 0.21 | 0.31 | 0.22 | 0.40 | 60 |
| sendToFirstChunkMs | 0.24 | 0.35 | 0.25 | 0.43 | 60 |
| agentChunkToAppMs | -0.18 | 0.25 | -0.19 | 0.32 | 60 |
| sendToEndMs | 0.27 | 0.41 | 0.29 | 0.51 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.06 | 1.52 | 60 |
| agentDecryptMs | 0.02 | 0.04 | 0.03 | 0.08 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.05 | 0.11 | 60 |
| appDecryptChunkMs | 0.04 | 0.09 | 0.05 | 0.13 | 60 |
| sendToRelayMs | 0.53 | 0.93 | 0.51 | 0.97 | 60 |
| relayToAgentMs | -0.44 | -0.01 | -0.44 | 0.07 | 60 |
| sendToAgentMs | 0.06 | 0.14 | 0.07 | 0.21 | 60 |
| sendToAckMs | 0.21 | 0.41 | 0.64 | 24.48 | 60 |
| sendToFirstChunkMs | 0.27 | 0.72 | 0.83 | 24.70 | 60 |
| agentChunkToAppMs | -0.11 | 0.33 | 0.40 | 24.16 | 60 |
| sendToEndMs | 0.30 | 0.77 | 0.87 | 24.78 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.10 | 60 |
| agentEncodeMs | 0.03 | 0.07 | 0.04 | 0.09 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60 |
| sendToAgentMs | 0.09 | 0.25 | 0.46 | 14.03 | 60 |
| sendToEchoMs | 0.24 | 0.90 | 0.78 | 14.27 | 60 |
| agentToAppMs | -0.20 | 0.20 | -0.06 | 8.93 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.03 | 0.03 | 0.04 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.04 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.14 | 60 |
| appDecryptMs | 0.02 | 0.04 | 0.03 | 0.04 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.09 | 1.55 | 60 |
| sendToEchoMs | 0.19 | 0.33 | 0.38 | 10.33 | 60 |
| agentToAppMs | -0.21 | 0.24 | -0.07 | 8.02 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

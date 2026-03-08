# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:40:30.180Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -10.75 ms (RTT 0.70 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.43 / p95=11.38 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.47 / p95=12.74 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 38.30 |
| pair/join | 29.48 |
| derive key (agent) | 1.82 |
| derive key (app) | 0.87 |
| socket connect (agent) | 9.88 |
| socket connect (app) | 10.82 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.06 | 0.04 | 0.14 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.14 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.19 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.07 | 60 |
| sendToRelayMs | -0.30 | 0.14 | -0.31 | 0.16 | 60 |
| relayToAgentMs | 0.39 | 0.90 | 0.38 | 0.91 | 60 |
| sendToAgentMs | 0.07 | 0.11 | 0.07 | 0.24 | 60 |
| sendToAckMs | 0.22 | 0.34 | 0.23 | 0.46 | 60 |
| sendToFirstChunkMs | 0.25 | 0.39 | 0.26 | 0.61 | 60 |
| agentChunkToAppMs | -0.18 | 0.25 | -0.20 | 0.28 | 60 |
| sendToEndMs | 0.30 | 0.47 | 0.31 | 0.68 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.05 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.07 | 1.39 | 60 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.05 | 0.13 | 60 |
| sendToRelayMs | -0.31 | 0.10 | -0.30 | 0.15 | 60 |
| relayToAgentMs | 0.41 | 0.83 | 0.39 | 0.94 | 60 |
| sendToAgentMs | 0.09 | 0.12 | 0.09 | 0.14 | 60 |
| sendToAckMs | 0.27 | 0.38 | 0.30 | 1.68 | 60 |
| sendToFirstChunkMs | 0.37 | 2.04 | 0.84 | 10.19 | 60 |
| agentChunkToAppMs | -0.05 | 1.55 | 0.35 | 9.87 | 60 |
| sendToEndMs | 0.41 | 2.07 | 0.88 | 10.25 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.10 | 0.04 | 0.17 | 60 |
| agentDecryptMs | 0.03 | 0.07 | 0.03 | 0.08 | 60 |
| agentEncodeMs | 0.03 | 0.08 | 0.04 | 0.12 | 60 |
| appDecryptMs | 0.03 | 0.10 | 0.04 | 0.18 | 60 |
| sendToAgentMs | 0.09 | 0.36 | 0.44 | 9.56 | 60 |
| sendToEchoMs | 0.25 | 9.87 | 1.05 | 17.17 | 60 |
| agentToAppMs | -0.21 | 0.34 | 0.24 | 17.05 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.05 | 1.24 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.06 | 60 |
| agentEncodeMs | 0.04 | 0.04 | 0.04 | 0.05 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.03 | 0.04 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.07 | 0.19 | 60 |
| sendToEchoMs | 0.18 | 0.29 | 0.20 | 0.38 | 60 |
| agentToAppMs | -0.26 | 0.21 | -0.24 | 0.22 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

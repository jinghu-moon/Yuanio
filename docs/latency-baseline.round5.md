# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:12:10.148Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -26.27 ms (RTT 0.44 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.34 / p95=11.22 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.36 / p95=11.22 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 43.34 |
| pair/join | 29.94 |
| derive key (agent) | 1.17 |
| derive key (app) | 0.42 |
| socket connect (agent) | 8.05 |
| socket connect (app) | 11.38 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.15 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentEncodeChunkMs | 0.03 | 0.06 | 0.04 | 0.08 | 60 |
| appDecryptChunkMs | 0.03 | 0.05 | 0.03 | 0.06 | 60 |
| sendToRelayMs | -0.06 | 0.33 | -0.10 | 0.37 | 60 |
| relayToAgentMs | 0.14 | 0.58 | 0.17 | 0.68 | 60 |
| sendToAgentMs | 0.06 | 0.11 | 0.07 | 0.14 | 60 |
| sendToAckMs | 0.19 | 0.32 | 0.21 | 0.39 | 60 |
| sendToFirstChunkMs | 0.22 | 0.35 | 0.23 | 0.41 | 60 |
| agentChunkToAppMs | -0.31 | 0.10 | -0.34 | 0.19 | 60 |
| sendToEndMs | 0.25 | 0.43 | 0.29 | 1.21 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.04 | 60 |
| agentEncodeChunkMs | 0.04 | 0.06 | 0.04 | 0.08 | 60 |
| appDecryptChunkMs | 0.04 | 0.06 | 0.06 | 1.10 | 60 |
| sendToRelayMs | -0.09 | 0.36 | -0.10 | 0.42 | 60 |
| relayToAgentMs | 0.15 | 0.61 | 0.16 | 0.69 | 60 |
| sendToAgentMs | 0.05 | 0.09 | 0.06 | 0.18 | 60 |
| sendToAckMs | 0.18 | 0.29 | 0.20 | 0.42 | 60 |
| sendToFirstChunkMs | 0.23 | 0.35 | 0.39 | 9.42 | 60 |
| agentChunkToAppMs | -0.28 | 0.17 | -0.15 | 8.79 | 60 |
| sendToEndMs | 0.26 | 0.43 | 0.45 | 9.48 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentDecryptMs | 0.03 | 0.06 | 0.03 | 0.07 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.04 | 0.25 | 60 |
| appDecryptMs | 0.02 | 0.04 | 0.03 | 0.09 | 60 |
| sendToAgentMs | 0.07 | 0.16 | 0.37 | 16.84 | 60 |
| sendToEchoMs | 0.21 | 0.57 | 0.78 | 25.55 | 60 |
| agentToAppMs | -0.32 | 0.13 | -0.08 | 8.12 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.02 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.02 | 0.06 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.04 | 0.14 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.05 | 1.35 | 60 |
| sendToAgentMs | 0.06 | 0.12 | 0.19 | 7.23 | 60 |
| sendToEchoMs | 0.19 | 0.36 | 0.45 | 7.51 | 60 |
| agentToAppMs | -0.37 | 0.09 | -0.24 | 6.80 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

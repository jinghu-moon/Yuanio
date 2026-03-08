# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:44:56.904Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -7.84 ms (RTT 0.30 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.36 / p95=11.09 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.37 / p95=11.12 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 34.06 |
| pair/join | 21.98 |
| derive key (agent) | 0.62 |
| derive key (app) | 0.24 |
| socket connect (agent) | 3.71 |
| socket connect (app) | 8.29 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.07 | 0.04 | 0.20 | 60 |
| agentDecryptMs | 0.03 | 0.06 | 0.04 | 0.16 | 60 |
| agentEncodeChunkMs | 0.04 | 0.12 | 0.05 | 0.33 | 60 |
| appDecryptChunkMs | 0.03 | 0.06 | 0.04 | 0.14 | 60 |
| sendToRelayMs | 0.03 | 0.42 | 0.00 | 0.53 | 60 |
| relayToAgentMs | 0.10 | 0.46 | 0.09 | 0.54 | 60 |
| sendToAgentMs | 0.08 | 0.20 | 0.09 | 0.38 | 60 |
| sendToAckMs | 0.26 | 0.42 | 0.28 | 1.30 | 60 |
| sendToFirstChunkMs | 0.29 | 0.61 | 0.32 | 1.34 | 60 |
| agentChunkToAppMs | 0.12 | 0.53 | 0.12 | 0.98 | 60 |
| sendToEndMs | 0.32 | 0.65 | 0.36 | 1.56 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.09 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.10 | 60 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.06 | 0.20 | 60 |
| appDecryptChunkMs | 0.05 | 0.09 | 0.05 | 0.14 | 60 |
| sendToRelayMs | 0.00 | 0.43 | 0.00 | 0.48 | 60 |
| relayToAgentMs | 0.07 | 0.56 | 0.08 | 0.59 | 60 |
| sendToAgentMs | 0.08 | 0.13 | 0.08 | 0.23 | 60 |
| sendToAckMs | 0.26 | 0.45 | 0.41 | 8.05 | 60 |
| sendToFirstChunkMs | 0.33 | 0.62 | 0.63 | 8.35 | 60 |
| agentChunkToAppMs | 0.14 | 0.67 | 0.38 | 7.72 | 60 |
| sendToEndMs | 0.37 | 0.69 | 0.67 | 8.43 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.06 | 60 |
| agentDecryptMs | 0.03 | 0.07 | 0.03 | 0.09 | 60 |
| agentEncodeMs | 0.04 | 0.07 | 0.04 | 0.09 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| sendToAgentMs | 0.10 | 0.69 | 0.67 | 15.81 | 60 |
| sendToEchoMs | 0.28 | 0.95 | 0.99 | 24.85 | 60 |
| agentToAppMs | 0.08 | 0.50 | 0.17 | 8.52 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.08 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.09 | 60 |
| agentEncodeMs | 0.03 | 0.06 | 0.04 | 0.09 | 60 |
| appDecryptMs | 0.03 | 0.06 | 0.07 | 1.27 | 60 |
| sendToAgentMs | 0.08 | 0.15 | 0.22 | 8.07 | 60 |
| sendToEchoMs | 0.24 | 0.36 | 0.38 | 8.49 | 60 |
| agentToAppMs | 0.07 | 0.51 | 0.07 | 0.55 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

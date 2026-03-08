# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T14:41:56.116Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是
- Relay 时钟偏移估计: -26.99 ms (RTT 0.37 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.47 / p95=10.99 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.50 / p95=11.08 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 34.29 |
| pair/join | 21.09 |
| derive key (agent) | 0.55 |
| derive key (app) | 0.27 |
| socket connect (agent) | 4.00 |
| socket connect (app) | 8.22 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.04 | 0.07 | 60 |
| agentDecryptMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| agentEncodeChunkMs | 0.04 | 0.07 | 0.04 | 0.15 | 60 |
| appDecryptChunkMs | 0.03 | 0.07 | 0.04 | 0.08 | 60 |
| sendToRelayMs | -0.38 | 0.06 | -0.38 | 0.13 | 60 |
| relayToAgentMs | 0.48 | 0.90 | 0.46 | 0.94 | 60 |
| sendToAgentMs | 0.08 | 0.13 | 0.08 | 0.24 | 60 |
| sendToAckMs | 0.25 | 0.37 | 0.27 | 0.49 | 60 |
| sendToFirstChunkMs | 0.27 | 0.42 | 0.30 | 0.55 | 60 |
| agentChunkToAppMs | -0.26 | 0.20 | -0.23 | 0.29 | 60 |
| sendToEndMs | 0.30 | 0.47 | 0.34 | 0.67 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.08 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.06 | 60 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.06 | 0.19 | 60 |
| appDecryptChunkMs | 0.05 | 0.10 | 0.06 | 0.30 | 60 |
| sendToRelayMs | -0.30 | 0.10 | -0.31 | 0.12 | 60 |
| relayToAgentMs | 0.39 | 0.85 | 0.40 | 0.93 | 60 |
| sendToAgentMs | 0.08 | 0.15 | 0.08 | 0.16 | 60 |
| sendToAckMs | 0.25 | 0.40 | 0.49 | 13.60 | 60 |
| sendToFirstChunkMs | 0.31 | 7.79 | 1.01 | 13.66 | 60 |
| agentChunkToAppMs | -0.14 | 6.77 | 0.51 | 12.84 | 60 |
| sendToEndMs | 0.35 | 8.95 | 1.45 | 18.22 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.10 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.05 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.11 | 60 |
| sendToAgentMs | 0.09 | 0.22 | 0.20 | 6.65 | 60 |
| sendToEchoMs | 0.23 | 0.49 | 0.36 | 6.93 | 60 |
| agentToAppMs | -0.25 | 0.14 | -0.27 | 0.27 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.03 | 0.19 | 60 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.04 | 60 |
| agentEncodeMs | 0.03 | 0.04 | 0.03 | 0.04 | 60 |
| appDecryptMs | 0.03 | 0.04 | 0.06 | 1.26 | 60 |
| sendToAgentMs | 0.08 | 0.11 | 0.08 | 0.15 | 60 |
| sendToEchoMs | 0.22 | 0.29 | 0.23 | 0.31 | 60 |
| agentToAppMs | -0.27 | 0.24 | -0.25 | 0.29 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

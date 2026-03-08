# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T12:59:11.671Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 否
- Relay 时钟偏移估计: -22.99 ms (RTT 0.33 ms, samples=7)
- Relay Event Loop Lag(开始): p50=9.24 / p95=10.71 / max=122.64 ms
- Relay Event Loop Lag(结束): p50=9.26 / p95=10.91 / max=122.64 ms

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 31.19 |
| pair/join | 22.18 |
| derive key (agent) | 0.75 |
| derive key (app) | 0.35 |
| socket connect (agent) | 4.86 |
| socket connect (app) | 8.96 |

## 场景: text-small

- Warmup: 5
- Iterations: 20
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.04 | 0.07 | 20 |
| agentDecryptMs | 0.03 | 0.05 | 0.04 | 0.07 | 20 |
| agentEncodeChunkMs | 0.04 | 0.08 | 0.05 | 0.10 | 20 |
| appDecryptChunkMs | 0.04 | 0.07 | 0.04 | 0.07 | 20 |
| sendToRelayMs | 0.35 | 0.75 | 0.38 | 0.79 | 20 |
| relayToAgentMs | -0.27 | 0.18 | -0.29 | 0.19 | 20 |
| sendToAgentMs | 0.08 | 0.11 | 0.08 | 0.12 | 20 |
| sendToAckMs | 0.28 | 0.38 | 0.29 | 0.68 | 20 |
| sendToFirstChunkMs | 0.32 | 0.45 | 0.33 | 0.91 | 20 |
| agentChunkToAppMs | 0.53 | 1.02 | 0.45 | 1.15 | 20 |
| sendToEndMs | 0.36 | 0.58 | 0.39 | 1.03 | 20 |

## 场景: text-large

- Warmup: 5
- Iterations: 20
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.05 | 0.04 | 0.14 | 20 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 20 |
| agentEncodeChunkMs | 0.05 | 0.08 | 0.06 | 0.23 | 20 |
| appDecryptChunkMs | 0.05 | 0.07 | 0.05 | 0.09 | 20 |
| sendToRelayMs | 0.37 | 0.73 | 0.33 | 0.74 | 20 |
| relayToAgentMs | -0.28 | 0.21 | -0.24 | 0.23 | 20 |
| sendToAgentMs | 0.07 | 0.19 | 0.08 | 0.23 | 20 |
| sendToAckMs | 0.24 | 0.45 | 0.26 | 0.53 | 20 |
| sendToFirstChunkMs | 0.28 | 0.53 | 0.33 | 0.79 | 20 |
| agentChunkToAppMs | 0.53 | 0.89 | 0.55 | 1.18 | 20 |
| sendToEndMs | 0.33 | 0.61 | 0.38 | 0.85 | 20 |

## 场景: binary-small

- Warmup: 5
- Iterations: 20
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.04 | 0.06 | 0.05 | 0.24 | 20 |
| agentDecryptMs | 0.03 | 0.11 | 0.09 | 1.23 | 20 |
| agentEncodeMs | 0.04 | 0.05 | 0.04 | 0.10 | 20 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.08 | 20 |
| sendToAgentMs | 0.10 | 0.20 | 0.12 | 0.30 | 20 |
| sendToEchoMs | 0.29 | 0.57 | 0.38 | 1.55 | 20 |
| agentToAppMs | 0.51 | 0.88 | 0.52 | 0.94 | 20 |

## 场景: binary-large

- Warmup: 5
- Iterations: 20
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 20 |
| agentDecryptMs | 0.02 | 0.03 | 0.03 | 0.07 | 20 |
| agentEncodeMs | 0.04 | 0.07 | 0.04 | 0.08 | 20 |
| appDecryptMs | 0.03 | 0.06 | 0.04 | 0.08 | 20 |
| sendToAgentMs | 0.07 | 0.10 | 0.07 | 0.10 | 20 |
| sendToEchoMs | 0.21 | 0.32 | 0.22 | 0.34 | 20 |
| agentToAppMs | 0.48 | 0.88 | 0.44 | 0.90 | 20 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

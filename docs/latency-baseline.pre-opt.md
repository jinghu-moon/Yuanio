# Yuanio 通信延迟基线报告

- 生成时间: 2026-03-03T10:25:03.327Z
- Server: http://127.0.0.1:3000
- OS/Arch: win32/x64
- Bun: 1.3.9
- Node: v24.3.0
- 自动拉起 Relay: 是

## 握手阶段

| 指标 | 耗时(ms) |
|---|---:|
| pair/create | 31.60 |
| pair/join | 22.02 |
| derive key (agent) | 0.54 |
| derive key (app) | 0.22 |
| socket connect (agent) | 4.00 |
| socket connect (app) | 8.00 |

## 场景: text-small

- Warmup: 10
- Iterations: 60
- Payload: prompt=128B, streamChunk=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.07 | 0.11 | 0.07 | 0.13 | 60 |
| agentDecryptMs | 0.05 | 0.09 | 0.05 | 0.13 | 60 |
| agentEncodeChunkMs | 0.05 | 0.09 | 0.06 | 0.13 | 60 |
| appDecryptChunkMs | 0.08 | 0.12 | 0.09 | 0.14 | 60 |
| sendToRelayMs | -24.00 | -24.00 | -23.95 | -22.00 | 60 |
| relayToAgentMs | 24.00 | 24.00 | 24.00 | 24.00 | 60 |
| sendToAgentMs | 0.00 | 0.00 | 0.05 | 2.00 | 60 |
| sendToAckMs | 15.00 | 17.10 | 38.72 | 732.00 | 60 |
| sendToFirstChunkMs | 15.00 | 17.10 | 38.78 | 734.00 | 60 |
| agentChunkToAppMs | 15.00 | 16.15 | 38.72 | 734.00 | 60 |
| sendToEndMs | 15.00 | 17.10 | 38.80 | 734.00 | 60 |

## 场景: text-large

- Warmup: 10
- Iterations: 60
- Payload: prompt=256B, streamChunk=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.07 | 0.14 | 0.09 | 0.21 | 60 |
| agentDecryptMs | 0.06 | 0.14 | 0.07 | 0.22 | 60 |
| agentEncodeChunkMs | 0.08 | 0.17 | 0.10 | 0.38 | 60 |
| appDecryptChunkMs | 0.12 | 0.21 | 0.15 | 1.08 | 60 |
| sendToRelayMs | -24.00 | -24.00 | -0.20 | 732.00 | 60 |
| relayToAgentMs | 24.00 | 25.00 | 24.27 | 26.00 | 60 |
| sendToAgentMs | 0.00 | 1.00 | 24.07 | 757.00 | 60 |
| sendToAckMs | 15.00 | 18.00 | 39.07 | 774.00 | 60 |
| sendToFirstChunkMs | 15.00 | 18.05 | 39.35 | 774.00 | 60 |
| agentChunkToAppMs | 15.00 | 17.00 | 15.23 | 19.00 | 60 |
| sendToEndMs | 15.00 | 18.05 | 39.43 | 774.00 | 60 |

## 场景: binary-small

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=128B, ptyOutput=256B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeMs | 0.03 | 0.05 | 0.03 | 0.06 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.03 | 0.07 | 60 |
| sendToAgentMs | 0.00 | 1.00 | 0.20 | 1.00 | 60 |
| sendToEchoMs | 0.00 | 1.00 | 0.27 | 1.00 | 60 |
| agentToAppMs | 0.00 | 1.00 | 0.07 | 1.00 | 60 |

## 场景: binary-large

- Warmup: 10
- Iterations: 60
- Payload: ptyInput=256B, ptyOutput=8192B

| 指标 | P50 | P95 | 均值 | 最大 | 样本数 |
|---|---:|---:|---:|---:|---:|
| appEncodeMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentDecryptMs | 0.03 | 0.04 | 0.03 | 0.05 | 60 |
| agentEncodeMs | 0.04 | 0.05 | 0.04 | 0.05 | 60 |
| appDecryptMs | 0.03 | 0.05 | 0.04 | 0.05 | 60 |
| sendToAgentMs | 0.00 | 1.00 | 0.10 | 1.00 | 60 |
| sendToEchoMs | 0.00 | 1.00 | 0.28 | 1.00 | 60 |
| agentToAppMs | 0.00 | 1.00 | 0.17 | 1.00 | 60 |

## 说明

1. 本报告是通信链路基准，主要用于后续优化前后对比。
2. 文本链路覆盖 prompt/ack/stream_chunk/stream_end。
3. 二进制链路覆盖 pty_input/pty_output。
4. 详细原始结果见同目录 JSON 文件。

# Yuanio 延迟分层拆解报告

- 基线来源: docs/latency-baseline.json
- 基线时间: 2026-03-03T11:17:06.292Z
- 环境: win32/x64, Bun 1.3.9, Node v24.3.0
- Server: http://127.0.0.1:3000

## 分层定义

1. App 侧序列化+加解密: appEncode + appDecrypt
2. Agent 侧序列化+加解密: agentDecrypt + agentEncode
3. Relay+传输+调度: 端到端减去两端处理后的残差
4. UI 渲染(Compose): 当前基线未覆盖

## 场景: text-small

- 类型: text
- 端到端指标: sendToFirstChunkMs
- Total P50/P95: 15.00 / 17.05 ms

| 分层 | P50(ms) | P50占比 | P95(ms) | P95占比 | 数据来源 | 备注 |
|---|---:|---:|---:|---:|---|---|
| App 侧序列化+加解密 | 0.18 | 1.2% | 0.31 | 1.8% | measured |  |
| Agent 侧序列化+加解密 | 0.13 | 0.9% | 0.23 | 1.4% | measured |  |
| Relay+传输+调度 | 14.69 | 97.9% | 16.51 | 96.9% | derived | relayToAgent p50/p95=6.00/6.00ms |
| UI 渲染(Compose) | - | - | - | - | not_measured | 当前基线运行在 CLI，未采集 Android 帧渲染耗时。 |

异常观察:
- sendToRelayMs 出现负值，存在跨进程/跨主机时钟偏移，需用单调时钟改造。
- sendToAckMs 尾延迟尖峰明显 (p95=17.05ms, p99=749.61ms)。

## 场景: text-large

- 类型: text
- 端到端指标: sendToFirstChunkMs
- Total P50/P95: 15.00 / 17.05 ms

| 分层 | P50(ms) | P50占比 | P95(ms) | P95占比 | 数据来源 | 备注 |
|---|---:|---:|---:|---:|---|---|
| App 侧序列化+加解密 | 0.19 | 1.3% | 0.35 | 2.0% | measured |  |
| Agent 侧序列化+加解密 | 0.14 | 0.9% | 0.28 | 1.7% | measured |  |
| Relay+传输+调度 | 14.68 | 97.8% | 16.42 | 96.3% | derived | relayToAgent p50/p95=6.00/6.00ms |
| UI 渲染(Compose) | - | - | - | - | not_measured | 当前基线运行在 CLI，未采集 Android 帧渲染耗时。 |

异常观察:
- sendToRelayMs 出现负值，存在跨进程/跨主机时钟偏移，需用单调时钟改造。
- sendToAckMs 尾延迟尖峰明显 (p95=17.05ms, p99=749.12ms)。

## 场景: binary-small

- 类型: binary
- 端到端指标: sendToEchoMs
- Total P50/P95: 0.00 / 1.00 ms

| 分层 | P50(ms) | P50占比 | P95(ms) | P95占比 | 数据来源 | 备注 |
|---|---:|---:|---:|---:|---|---|
| App 侧序列化+加解密 | 0.06 | - | 0.10 | 10.0% | measured |  |
| Agent 侧序列化+加解密 | 0.05 | - | 0.14 | 14.1% | measured |  |
| Relay+传输+调度 | 0.00 | - | 0.76 | 75.9% | derived |  |
| UI 渲染(Compose) | - | - | - | - | not_measured | 当前基线运行在 CLI，未采集 Android 帧渲染耗时。 |

异常观察:
- sendToEchoMs 的 P50 为 0ms（毫秒粒度下限），P50 占比不可用，请以 P95 与均值为主。

## 场景: binary-large

- 类型: binary
- 端到端指标: sendToEchoMs
- Total P50/P95: 0.00 / 1.00 ms

| 分层 | P50(ms) | P50占比 | P95(ms) | P95占比 | 数据来源 | 备注 |
|---|---:|---:|---:|---:|---|---|
| App 侧序列化+加解密 | 0.06 | - | 0.08 | 8.3% | measured |  |
| Agent 侧序列化+加解密 | 0.06 | - | 0.08 | 8.5% | measured |  |
| Relay+传输+调度 | 0.00 | - | 0.83 | 83.2% | derived |  |
| UI 渲染(Compose) | - | - | - | - | not_measured | 当前基线运行在 CLI，未采集 Android 帧渲染耗时。 |

异常观察:
- sendToEchoMs 的 P50 为 0ms（毫秒粒度下限），P50 占比不可用，请以 P95 与均值为主。

## 优先优化建议(按绝对耗时 P50 排序)

| 排名 | 场景 | 分层 | P50(ms) | 占比 |
|---:|---|---|---:|---:|
| 1 | text-small | Relay+传输+调度 | 14.69 | 97.9% |
| 2 | text-large | Relay+传输+调度 | 14.68 | 97.8% |
| 3 | text-large | App 侧序列化+加解密 | 0.19 | 1.3% |
| 4 | text-small | App 侧序列化+加解密 | 0.18 | 1.2% |
| 5 | text-large | Agent 侧序列化+加解密 | 0.14 | 0.9% |
| 6 | text-small | Agent 侧序列化+加解密 | 0.13 | 0.9% |

## 结论

1. 当前瓶颈集中在 Relay+传输+调度层，端侧加解密已低于 1ms。
2. 文本链路需要优先处理尾延迟尖峰（p99 远高于 p95）。
3. UI 渲染需在 Android 端补充 Macrobenchmark，才能完成真实端到端闭环。

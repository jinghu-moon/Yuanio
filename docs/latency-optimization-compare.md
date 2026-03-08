# 延迟优化对比报告

- 对比基线(优化前): `latency-baseline.pre-opt.json`
- 对比基线(优化后): `latency-baseline.json`
- 生成时间: 2026-03-03T11:18:49.606Z

## 本轮变更

1. Relay/CLI/Android 改为 WebSocket-only，禁用 polling 回退。
2. Relay 关闭 Socket.IO 压缩与升级路径。
3. Relay 持久化改为事务批写 + 分片 flush，降低事件循环阻塞。
4. Agent 事件分发新增高低优先级队列，优先发送 STREAM_CHUNK/THINKING/ERROR。

## 关键指标对比

| 场景 | 指标 | P50(前→后) | P95(前→后) | P99(前→后) | Mean(前→后) | Max(前→后) |
|---|---|---:|---:|---:|---:|---:|
| text-small | sendToFirstChunkMs | 15.00 → 15.00 | 17.10 → 17.05 | 725.74 → 749.61 | 38.78 → 39.87 | 734.00 → 762.00 |
| text-small | sendToAckMs | 15.00 → 15.00 | 17.10 → 17.05 | 724.33 → 749.61 | 38.72 → 39.87 | 732.00 → 762.00 |
| text-large | sendToFirstChunkMs | 15.00 → 15.00 | 18.05 → 17.05 | 725.03 → 750.30 | 39.35 → 39.93 | 774.00 → 768.00 |
| text-large | sendToAckMs | 15.00 → 15.00 | 18.00 → 17.05 | 725.03 → 749.12 | 39.07 → 39.80 | 774.00 → 768.00 |
| text-large | sendToAgentMs | 0.00 → 0.00 | 1.00 → 1.05 | 710.39 → 2.00 | 24.07 → 0.28 | 757.00 → 2.00 |
| binary-large | sendToEchoMs | 0.00 → 0.00 | 1.00 → 1.00 | 1.00 → 1.00 | 0.28 → 0.22 | 1.00 → 1.00 |

## 观察

1. `text-large/sendToAgentMs` 的长尾显著收敛（p99 由 700ms+ 降到个位数毫秒）。
2. `sendToFirstChunkMs` 的 P50 仍在 15ms，主要受 Windows 定时粒度与跨进程时间戳口径影响。
3. 文本链路仍有偶发 700ms 级 outlier，需要继续做“单调时钟埋点 + 事件循环阻塞剖析”。

## 下一步

1. 将链路时序埋点从 `Date.now` 升级为单调时钟并做时钟偏移校正。
2. 在 Relay 增加 event loop lag 监控，定位 700ms 尾延迟触发点。
3. 补充 Android Macrobenchmark，纳入 UI 渲染耗时闭环。

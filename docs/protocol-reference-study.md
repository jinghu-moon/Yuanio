# refer/server 协议学习笔记（面向 Agent 通信优化）

更新时间：2026-03-03

## 1. 学习范围

本轮阅读了 `refer/server` 下的这些实现：

- Socket.IO 会话恢复与客户端重连
- Socket.IO Redis Streams 适配器
- NATS JetStream（JS 客户端 + Server 约束）
- Netflix `concurrency-limits`
- uWebSockets.js 背压示例
- RSocket（resume / lease / requestN）
- QUIC（quiche / quic-go）基础实现要点

## 2. 可直接复用的机制（按优先级）

### P0. 持久化消息与瞬时消息分流

关键来源：

- `refer/server/socket.io-redis-streams-adapter-main/lib/adapter.ts:261`
- `refer/server/socket.io-redis-streams-adapter-main/lib/adapter.ts:311`
- `refer/server/socket.io-redis-streams-adapter-main/lib/adapter.ts:314`

结论：

- 适配器将消息分为两类：
- 可丢失瞬时消息（ephemeral）走 PUB/SUB，低延迟。
- 需要恢复/重放的消息走 Redis Stream（XADD/XREAD/XRANGE）。

对 Yuanio 的映射：

- 当前已有非持久化类型集合（`stream_chunk/thinking/heartbeat/status/terminal_output/pty_*`）这一方向正确。
- 下一步应继续细化“必须持久化”的最小集合：例如 `prompt/request/result/meta`，其余尽量走瞬时链路。

---

### P0. 游标恢复 + 有限重放窗口

关键来源：

- `refer/server/socket.io-main/packages/socket.io-adapter/lib/in-memory-adapter.ts:425`
- `refer/server/socket.io-main/packages/socket.io-adapter/lib/in-memory-adapter.ts:453`
- `refer/server/socket.io-main/packages/socket.io-adapter/lib/in-memory-adapter.ts:497`
- `refer/server/socket.io-redis-streams-adapter-main/lib/adapter.ts:437`
- `refer/server/socket.io-redis-streams-adapter-main/lib/adapter.ts:469`

结论：

- 会话恢复依赖 `(sessionId, offset)`。
- 偏移点不存在或过期直接恢复失败（不做“假恢复”）。
- 重放循环必须有硬上限（`RESTORE_SESSION_MAX_XRANGE_CALLS = 100`）防止无限追赶。

对 Yuanio 的映射：

- 已具备 `afterCursor/nextCursor` 与分页追赶。
- 建议再加“服务端硬上限 + 恢复失败原因码”，让客户端可区分：`offset_expired` / `session_expired` / `retry_later`。

---

### P0. 背压显式治理（不要只靠 Socket 缓冲）

关键来源：

- `refer/server/uWebSockets.js-master/examples/Backpressure.js:43`
- `refer/server/uWebSockets.js-master/examples/Backpressure.js:49`
- `refer/server/uWebSockets.js-master/examples/SlowReceiver.js:12`
- `refer/server/uWebSockets.js-master/examples/SlowReceiver.js:13`
- `refer/server/uWebSockets.js-master/examples/SlowReceiver.js:22`

结论：

- 发送前必须检查缓冲（`getBufferedAmount()`）。
- 使用 `drain` 回调继续发送。
- 达到 `maxBackpressure` 可主动断开慢消费者（`closeOnBackpressureLimit`）。

对 Yuanio 的映射：

- 当前主要在应用层做恢复和重试，但缺少“每连接发送窗口”与“慢端保护”。
- 建议为设备连接增加：
- `maxBufferedBytes`
- `maxInFlightEnvelopes`
- 超限策略（drop transient / 降采样 stream_chunk / 断开重连）

---

### P0. ACK 语义分层（成功/重试/处理中/终止）

关键来源：

- `refer/server/nats.js-main/jetstream/src/jsmsg.ts:318`
- `refer/server/nats.js-main/jetstream/src/jsmsg.ts:322`
- `refer/server/nats.js-main/jetstream/src/jsmsg.ts:332`
- `refer/server/nats.js-main/jetstream/src/jsmsg.ts:349`
- `refer/server/nats-server-main/server/consumer.go:631`
- `refer/server/nats-server-main/server/consumer.go:899`

结论：

- ACK 不应只有一种：
- `ack()`：完成
- `nak(delay)`：要求延迟重投
- `working()`：续租，表示仍在处理
- `term(reason)`：终止重投
- 服务端要配套 `ack_wait`、`max_ack_pending`、`max_deliver` 等窗口约束。

对 Yuanio 的映射：

- 当前 ACK 主要是“收到确认”。
- 下一步可引入：
- `ACK_PROGRESS`（等价 working）
- `ACK_RETRY_AFTER`（等价 nak delay）
- `ACK_TERMINAL`（永久失败）

---

### P1. 心跳与流控绑定、误判抑制

关键来源：

- `refer/server/nats.js-main/jetstream/src/pushconsumer.ts:172`
- `refer/server/nats.js-main/jetstream/src/pushconsumer.ts:301`
- `refer/server/nats.js-main/jetstream/src/pushconsumer.ts:259`
- `refer/server/nats.js-main/jetstream/src/consumer.ts:389`
- `refer/server/nats-server-main/server/consumer.go:899`

结论：

- 开启流控必须有心跳（Server 直接约束）。
- 客户端通常以“连续丢 2 个心跳”判定异常（`maxOut: 2`），降低误报。

对 Yuanio 的映射：

- 当前已有 heartbeat，但“断线判定阈值/连丢次数”建议标准化。
- 建议采用：`timeout = max(2 * heartbeatInterval, 5s)`，并记录 `missed_heartbeats` 指标。

---

### P1. 重连抖动（防雪崩）

关键来源：

- `refer/server/socket.io-main/packages/socket.io-client/lib/manager.ts:175`
- `refer/server/socket.io-main/packages/socket.io-client/lib/manager.ts:587`
- `refer/server/socket.io-main/packages/socket.io-client/lib/contrib/backo2.ts:29`

结论：

- 指数退避必须带抖动（jitter），否则同时断线会同时回连，放大抖动。

对 Yuanio 的映射：

- Android / CLI 的重连策略建议统一为：
- base delay + exponential + jitter（full jitter 或 equal jitter）

---

### P1. 自适应并发限制（降尾延迟）

关键来源：

- `refer/server/concurrency-limits-main/.../AIMDLimit.java:102`
- `refer/server/concurrency-limits-main/.../VegasLimit.java:279`
- `refer/server/concurrency-limits-main/.../GradientLimit.java:265`

结论：

- AIMD：简单稳健，超时/丢包快速降并发。
- Vegas：利用 `RTT_no_load` 与队列估计做细粒度调节。
- Gradient：用 RTT 梯度 + queueSize 动态平衡吞吐与延迟。

对 Yuanio 的映射：

- 可先在 Relay 出站队列上实现轻量 AIMD（最小改动）：
- 输入：`ack_rtt_p95`、`drop/timeout`、`eventLoopLag`
- 输出：`maxInFlight` 动态值

---

### P2. RSocket 的 resume/requestN/lease 思路

关键来源：

- `refer/server/rsocket-js-1.0.x-alpha/packages/rsocket-core/src/RSocketConnector.ts:50`
- `refer/server/rsocket-js-1.0.x-alpha/packages/rsocket-core/src/RSocketConnector.ts:88`
- `refer/server/rsocket-js-1.0.x-alpha/packages/rsocket-examples/src/ClientServerRequestChannelResumeExample.ts:84`
- `refer/server/rsocket-js-1.0.x-alpha/packages/rsocket-examples/src/ClientServerRequestChannelResumeExample.ts:77`

结论：

- resume token + 帧位置（client/server position）可做断线续传。
- requestN 是天然背压信号（接收方拉取）。
- lease 控制时间窗内可处理请求额度。

对 Yuanio 的映射：

- 不必整体迁移 RSocket，但可借鉴为协议字段：
- `credit`（类似 requestN）
- `resumeToken` + `lastServerPos`
- `leaseTtl` + `leaseQuota`

---

### P2. QUIC 的工程要点

关键来源：

- `refer/server/quiche-master/README.md`
- `refer/server/quic-go-master/README.md`

结论：

- QUIC 库强调应用层必须管理事件循环与超时定时器。
- 发包建议按 pacing hints 发送，避免短时突发导致丢包和尾延迟抬升。

对 Yuanio 的映射：

- 若后续考虑 WebTransport/QUIC 通道，先做“事件循环分离 + 定时器与发送节奏控制”再迁移协议。

## 3. 对当前 Yuanio 现状的对照

已对齐：

- `afterCursor/nextCursor` 恢复机制（Relay + Android）。
- 非持久化消息类型分流。
- 连接恢复（Socket.IO connectionStateRecovery）。

未充分对齐：

- 连接级背压窗口（buffer/inflight）仍不足。
- ACK 语义还不够细（缺 progress/retry-after/terminal）。
- 自适应并发控制尚未接入真实链路。
- 心跳/流控指标未形成统一观测面板。

## 4. 下一轮改造建议（最小可行）

1. 在 Relay 加 `maxInFlightPerDevice` 与 `maxBufferedBytesPerDevice`，超限优先丢 transient。
2. 为协议新增 `ackState`（`ok|working|retry_after|terminal`）并联动客户端重试。
3. 引入轻量 AIMD（输入 `ack_rtt_p95 + timeout_rate + event_loop_lag`，输出 `maxInFlight`）。
4. 增加 4 个核心指标：`send_buffer_bytes`、`inflight_envelopes`、`ack_rtt_p95`、`missed_heartbeats`。


# 通信协议与 API 设计

> ⚠️ 标注说明：✅ = 已实现，🔲 = 计划/未实现，🟡 = 部分实现（仅特定路径）

## 1. 传输层

所有通信基于 Socket.IO（底层 WSS），上层使用 JSON + Base64 编码 + E2E 加密。运行时为 Bun。

```
┌─────────────────────────────────┐
│  应用层 (JSON Message)           │
├─────────────────────────────────┤
│  加密层 (WebCrypto AES-GCM /     │
│         TweetNaCl box)           │
├─────────────────────────────────┤
│  编码层 (Base64)                 │
├─────────────────────────────────┤
│  传输层 (Socket.IO / WSS)        │
├─────────────────────────────────┤
│  TLS 1.3                        │
└─────────────────────────────────┘
```

- 生产路径（CLI/Daemon/浏览器）使用 WebCrypto ECDH(P-256)+HKDF+AES-GCM，支持 AAD。
- 兼容/测试路径保留 TweetNaCl box（Curve25519 + XSalsa20-Poly1305）。

## 2. 消息类型定义

### 2.1 信封格式（中继服务器可见）

**当前规范（扁平字段）：**
```json
{
  "id": "uuid-v7",
  "seq": 42,
  "source": "device-id-sender",
  "target": "device-id-receiver | broadcast",
  "sessionId": "session-uuid",
  "type": "prompt | stream_chunk | stream_end | tool_call | file_diff | diff_action | diff_action_result | approval_req | approval_resp | status | heartbeat | pty_* | ...",
  "ts": 1700000000000,
  "payload": "base64(iv|nonce + ciphertext)",
  "ptyId": "optional",
  "relayTs": 1700000000000
}
```

**Binary 信封（PTY 等高频消息）：**结构同上，但 `payload` 为原始 `Uint8Array`（不做 Base64）。

**字段实现状态：**

| 字段 | 状态 | 说明 |
|------|------|------|
| `id` | ✅ | UUID v7（去重 + 时间排序） |
| `seq` | ✅ | 发送端递增序列 |
| `source/target/sessionId/type/ts` | ✅ | 路由必要字段 |
| `payload` | ✅ | Base64(iv/nonce + ciphertext) 或 binary payload |
| `ptyId` | ✅ | PTY 会话标识（可选） |
| `relayTs` | ✅ | relay 接收时间戳（调试） |
| AAD | 🟡 | 仅 AES-GCM 路径使用 |
| `header.*` | 🔲 | 旧版简化格式（已废弃） |

**加密细节：**
- AES-GCM：`payload = Base64(iv(12B) + ciphertext)`，AAD 绑定 `id/seq/source/target/sessionId/type/ts/ptyId`。
- NaCl box：`payload = Base64(nonce(24B) + ciphertext)`，无 AAD。

### 2.2 载荷消息（E2E 加密内容，中继服务器不可见）

解密后的 `payload` 为 UTF-8 文本，当前实现分为纯文本与 JSON 文本两类：

**✅ prompt / stream_chunk / stream_end（纯文本）：**
```text
帮我重构这个函数
```

**✅ tool_call（JSON）：**
```json
{ "tool": "Write", "params": { "path": "src/index.ts" }, "status": "running" }
```

**✅ file_diff（JSON）：**
```json
{ "path": "src/index.ts", "diff": "@@ -1 +1 @@\n-old\n+new", "action": "modified" }
```

**✅ diff_action（JSON）：**
```json
{ "path": "src/index.ts", "action": "accept | rollback" }
```

**✅ diff_action_result（JSON）：**
```json
{ "path": "src/index.ts", "action": "accept", "success": true, "error": "" }
```

**✅ approval_req / approval_resp（JSON）：**
```json
{ "id": "apv_1", "description": "写入文件 src/index.ts", "tool": "Write", "affectedFiles": ["src/index.ts"] }
```
```json
{ "id": "apv_1", "approved": true }
```

**✅ status / heartbeat（JSON）：**
```json
{ "status": "running", "projectPath": "/home/user/my-project" }
```
```json
{ "status": "running", "uptime": 120, "agent": "claude" }
```

**✅ 其他已实现类型（摘要）：**
- `hook_event`（hook 事件）
- `session_switch` / `session_switch_ack`
- `rpc_req` / `rpc_resp`
- `pty_*`（pty_spawn/input/output/resize/exit/kill/ack/status）

## 3. REST API（中继服务器 — Bun + Hono）

配对与会话查询使用 HTTPS REST API，实时通信使用 Socket.IO。

### 3.1 设备配对 ✅

```
POST /api/v1/pair/create
```
请求体：
```json
{ "publicKey": "base64编码的公钥" }
```
响应：
```json
{ "pairingCode": "A3X-9K2", "sessionToken": "jwt-token", "deviceId": "dev_x", "sessionId": "sess_x" }
```

```
POST /api/v1/pair/join
```
请求体：
```json
{ "code": "A3X-9K2", "publicKey": "base64编码的公钥" }
```
响应：
```json
{ "agentPublicKey": "base64编码的Agent公钥", "sessionToken": "jwt-token", "deviceId": "dev_y", "sessionId": "sess_x" }
```

```
GET /api/v1/pair/status/:code
```
响应：
```json
{ "joined": true, "appPublicKey": "base64公钥或null" }
```

### 3.2 Token 与会话接口 ✅

```
POST /api/v1/token/revoke
```
请求体：
```json
{ "token": "jwt-token" }
```
响应：
```json
{ "revoked": true }
```

```
POST /api/v1/token/refresh
```
请求头：`Authorization: Bearer <token>`
响应：
```json
{ "sessionToken": "new-jwt-token" }
```

```
GET /api/v1/sessions/:id/messages
```
请求头：`Authorization: Bearer <token>`
查询参数：
- `afterCursor`（推荐，基于 relay 持久化游标，断线恢复更可靠）
- `after`（兼容旧客户端，基于消息 ts 毫秒时间戳）
- `limit`（默认 100，最大 500）
响应：
```json
{ "messages": [], "count": 0, "nextCursor": 0 }
```

```
GET /api/v1/queue/pending
```
请求头：`Authorization: Bearer <token>`
查询参数：`limit`（默认 100，最大 500）
响应：
```json
{ "messages": [], "count": 0 }
```

```
GET /api/v1/sessions
```
请求头：`Authorization: Bearer <token>`
响应：
```json
{ "currentSessionId": "sess_x", "sessions": [] }
```

```
GET /api/v1/sessions/:id/connections
```
响应：
```json
{ "logs": [], "count": 0 }
```

```
GET /api/v1/sessions/:id/version
```
响应：
```json
{ "version": 1 }
```

```
POST /api/v1/sessions/switch
```
请求头：`Authorization: Bearer <token>`
请求体：`{ "sessionId": "optional" }`
响应：
```json
{ "sessionId": "sess_new", "tokens": { "dev_x": "jwt" } }
```

```
POST /api/v1/sessions/:id/update
```
请求体：`{ "expectedVersion": 1 }`
响应：
```json
{ "success": true, "newVersion": 2 }
```

### 3.3 基础路由（调试/原型） ✅

```
GET /health
GET /relay/state
POST /sessions
GET /sessions/:id
```

`GET /relay/state` 用于显式返回 relay 冷启动状态：
- `200`：`status = "ready"`
- `202`：`status = "warming_up"`（建议客户端按 `retryAfterMs` 重试）

`GET /health` 还会返回推送相关运行态：

```json
{
  "fcm": {
    "enabled": true,
    "pushRegisterRateLimit": { "max": 20, "windowMs": 60000 }
  }
}
```

响应示例：
```json
{
  "status": "warming_up",
  "protocolVersion": "1.0.0",
  "serverNowMs": 1700000000000,
  "retryAfterMs": 1200,
  "runtime": {
    "trackedSessions": 3,
    "activeSessions": 2,
    "warmingUpSessions": 1
  }
}
```

### 3.4 推送注册 ✅

```
POST /api/v1/push/register
Authorization: Bearer <sessionToken>
```

请求体：
```json
{ "token": "<fcmToken>" }
```

仅接受字段：`token`（不再兼容 `fcmToken`）。

响应：
```json
{
  "registered": true,
  "deviceId": "dev_x",
  "role": "app",
  "sessionId": "sess_x"
}
```

说明：
- 需 JWT 鉴权，且校验 token 对应设备与会话命名空间归属。
- Socket.IO 事件 `register_fcm_token` 仍可用，并与 HTTP 入口复用同一注册逻辑（见 3.5）。
- 客户端建议：连接建立后先发 `register_fcm_token`，再异步补一次 HTTP 注册以提高成功率。
- 服务端在推送返回 token 无效时会自动清理该 token。
- 默认限流：同一 IP 每分钟最多 20 次（可用 `YUANIO_PUSH_REGISTER_RATE_LIMIT_MAX`、`YUANIO_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS` 调整）。

FCM data 字段（结构化）：

```json
{
  "eventType": "approval_requested|task_completed|run_failed",
  "messageType": "approval_req|stream_end|status",
  "sessionId": "sess_x",
  "messageId": "uuid-v7"
}
```

### 3.5 Socket.IO 实时通信 ✅

```
连接地址: wss://relay.yuanio.dev
命名空间: /relay
认证: { token: "sessionToken", protocolVersion: "1.0.0" }
```

补充说明：

- `protocolVersion` 用于客户端/服务端主版本兼容校验（主版本不一致会拒绝连接）。
- 支持逻辑命名空间（`namespace`），用于多环境隔离；命名空间随 token claim 下发，不在明文消息体中重复传输。

**Socket.IO 事件定义：**

| 事件名 | 方向 | 状态 | 说明 |
|--------|------|------|------|
| `message` | 双向 | ✅ | 发送/接收加密信封 |
| `device:online` | 服务器→客户端 | ✅ | 对端设备上线通知 |
| `device:offline` | 服务器→客户端 | ✅ | 对端设备离线通知 |
| `device_list` | 服务器→客户端 | ✅ | 当前会话在线设备列表 |
| `server_state` | 服务器→客户端 | ✅ | 当前会话运行态（`warming_up/ready`、建议重试间隔） |
| `ack` | 双向 | ✅ | 消息确认（见 4） |
| `register_fcm_token` | 客户端→服务器 | ✅ | 注册 FCM token |
| `error` | 服务器→客户端 | 🔲 | 错误通知（预留） |

`register_fcm_token` 事件载荷（严格模式）：
```json
{ "token": "<fcmToken>" }
```

**ACK 结构（非加密）：**
```json
{ "messageId": "uuid-v7", "source": "device_id", "sessionId": "sess_x" }
```

## 4. 心跳与重连 ✅

- Socket.IO 心跳：`pingInterval=20s`，`pingTimeout=20s`。
- 应用层心跳：`heartbeat` 消息类型，30s 周期（CLI 发送）。
- 重连策略：Socket.IO 内置指数退避。
- ACK 机制：当前仅 `prompt` 需要 ACK；5s 超时重发，最多 3 次。
- relay 会话运行态新增“启动屏障 + 引用计数 + 空闲回收”：
  - 同一会话并发进入只执行一次 warmup（屏障复用）。
  - 连接引用计数归零后进入 idle，超过 `YUANIO_RELAY_SESSION_IDLE_RECLAIM_MS` 后回收内存态。

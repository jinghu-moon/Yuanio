# WS 协议迁移矩阵（Socket.IO → WebSocket）

> 目标：为 Relay / Android / Desktop 统一原生 WebSocket 事件契约，替代 Socket.IO。

## 连接与鉴权

| 阶段 | Socket.IO | WebSocket（新） | 说明 |
| --- | --- | --- | --- |
| 建连 | `io("/relay", { auth })` | `ws://<host>/relay-ws` | 改为原生 WS 入口 |
| 鉴权 | `auth.token` + `auth.protocolVersion` | 首帧 `hello` | WS 需显式发送 `hello` |
| 命名空间 | `namespace` 绑定在 token | `hello.namespace` | 仍以 token 为主，`hello` 可显式传 |

## 帧格式

WS 使用 JSON 文本帧，统一结构：

```json
{ "type": "<event>", "data": { ... } }
```

事件类型：`hello | message | ack | presence | error`

## 事件映射（核心）

| Socket.IO event | WS frame | Payload | 备注 |
| --- | --- | --- | --- |
| `connect` | `hello`（client → server） | `WsHelloPayload` | 传 `token`、`protocolVersion`、`namespace`、`deviceId`、`role`，可选 `capabilities` |
| `message` | `message` | `Envelope` | 加密消息 |
| `ack` | `ack` | `AckMessage` | 可靠投递回执 |
| `device_list` | `presence` | `WsPresencePayload` | 设备列表快照 |
| `device:online` | `presence` | `WsPresencePayload` | 由列表刷新替代 |
| `connect_error` | `error` | `WsErrorPayload` | 鉴权/协议错误 |
| `disconnect` | （close） | close code + reason | 由 WS 连接状态承接 |

## 关键字段对齐

### hello（client → server）

```json
{
  "type": "hello",
  "data": {
    "token": "session_token",
    "protocolVersion": "1.0.0",
    "namespace": "default",
    "deviceId": "dev_1",
    "role": "app",
    "capabilities": {
      "binaryPayload": true,
      "ackQueue": true,
      "presence": true
    }
  }
}
```

### message

`data` 直接使用 `EnvelopeSchema`（`id/seq/source/target/sessionId/type/ts/payload`）。

#### payload 二进制约定（WS JSON）

- **规范格式**：`{ "type": "Buffer", "data": [0-255...] }`
- **说明**：WS 采用 JSON 文本帧时，二进制 payload 必须封装为 Buffer JSON，以便 relay 与 Android 端统一解析。
- **长度上限**：`MAX_ENVELOPE_BINARY_PAYLOAD_BYTES`（1,048,576 bytes）
- **进程内表示**：允许 `Uint8Array` / `ArrayBuffer`，上行文本帧需序列化为 Buffer JSON。
- **示例**：

```json
{
  "type": "message",
  "data": {
    "id": "msg_bin_1",
    "seq": 2,
    "source": "app",
    "target": "agent",
    "sessionId": "sess_1",
    "type": "pty_output",
    "ts": 1700000000000,
    "payload": {
      "type": "Buffer",
      "data": [1, 2, 3, 255]
    }
  }
}
```

`data` 直接使用 `EnvelopeSchema`（`id/seq/source/target/sessionId/type/ts/payload`）。

### ack

`data.messageId` 对齐 `Envelope.id`，`state` 取值：`ok | working | retry_after | terminal`。

### presence

`data.devices`：`[{ id, role, sessionId }]`

## 兼容性规则

- `PROTOCOL_VERSION` 主版本不一致直接拒绝。
- 旧客户端（未上报 `protocolVersion`）在兼容期开启允许接入（由 Relay 控制）。

## 迁移阶段约束

1. P2 Relay 完成 `/relay-ws` 与 ACK 队列后，允许 Android/Desktop 迁移。
2. P5 开关切换到 WS-only 后，删除 Socket.IO 依赖。

## 端侧迁移状态

- Android WS: ✅ 已切换到 `RelayWebSocketClient`（P3-N2）。

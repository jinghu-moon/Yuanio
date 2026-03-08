# 架构设计

## 1. 系统总览

Yuanio 采用四组件架构，通过中继服务器实现手机与电脑之间的安全通信。

```
┌──────────────┐                  ┌──────────────┐                  ┌──────────────────┐
│ Android App  │  Socket.IO/E2E   │ Relay Server │  Socket.IO/E2E   │ Yuanio CLI     │
│ (Kotlin)     │◄────────────────►│ (Bun)        │◄────────────────►│ + Daemon         │
│              │                  │              │                  │ (Bun)            │
│ ┌──────────┐ │                  │ ┌──────────┐ │                  │ ┌──────────────┐ │
│ │ UI       │ │                  │ │ Hono HTTP│ │                  │ │ 本地: spawn  │ │
│ ├──────────┤ │                  │ ├──────────┤ │                  │ │ 远程: spawn  │ │
│ │ 加密层   │ │                  │ │ Socket.IO│ │                  │ ├──────────────┤ │
│ └──────────┘ │                  │ ├──────────┤ │                  │ │ 模式切换     │ │
│              │                  │ │bun:sqlite│ │                  │ ├──────────────┤ │
│              │                  │ └──────────┘ │                  │ │ WebCrypto    │ │
└──────────────┘                  └──────────────┘                  └──────────────────┘
                                         ↕                                  ↕
                                  ┌──────────────┐                  ┌──────────────┐
                                  │  Cloudflare  │                  │ Claude Code  │
                                  │  Tunnel(可选) │                  └──────────────┘
                                  └──────────────┘
```

## 2. 组件职责

### 2.1 Yuanio CLI（前台交互进程）

**运行环境：** 用户电脑（Windows/macOS/Linux）

**集成模式：双模式 CLI 包装器**（参考 Happy/HAPI 源码验证的方案）

用户运行 `yuanio` 替代 `claude`：
```bash
yuanio          # 包装 claude code，同时启用远程控制
yuanio codex    # 包装 codex（未来扩展）
```

**双模式架构：**

| 模式 | 实现方式 | 触发条件 | 用户体验 |
|------|---------|---------|---------|
| 本地模式 | `spawn` Claude Code CLI 子进程，stdio inherit | 默认 / 用户按双空格 | 终端正常交互 |
| 远程模式 | `spawn claude -p --output-format stream-json` | 手机发来 prompt | 手机控制，终端只读 |

**模式切换循环：**
```
启动 → 本地模式（spawn CLI 子进程）
         ↓ 手机发来 prompt
       远程模式（spawn stream-json）
         ↓ 用户按双空格
       本地模式（重新 spawn CLI）
         ↓ ...循环
```

**进程模型：**
```
Yuanio CLI (主进程)
├── Local Launcher   ── spawn claude CLI，stdio inherit + Hook 服务器监听事件
├── Remote Launcher  ── spawn claude -p stream-json，解析 JSON 流输出
├── Mode Switch      ── 双空格检测 + 手机消息触发切换
├── Socket.IO Client ── 连接中继服务器
├── Adapter Layer    ── 解析 stream-json / hook 事件，归一化 tool_call/file_diff
└── Crypto Module    ── WebCrypto ECDH+HKDF+AES-GCM（生产路径）
    + Keystore Bridge ── 可选 `YUANIO_SESSION_TOKEN_FILE` 跨进程 token 文件同步
```

### 2.2 Yuanio Daemon（后台常驻进程）

**运行环境：** 用户电脑，后台常驻

**核心职责：**
- 会话持久化管理（维护会话 ID 列表，支持 `--resume`）
- 接收手机远程发起的"新建会话"请求
- 当 CLI 未运行时，代为接收消息并缓存
- 管理与中继服务器的长连接（CLI 退出后仍保持）

**启动方式：**
```bash
yuanio daemon start   # 启动后台进程
yuanio daemon stop    # 停止
yuanio daemon status  # 查看状态
```

> 注：Windows 上使用 `child_process.spawn` + `detached: true` 实现后台运行（无 fork()）。

### 2.3 云中继服务器 (Relay Server)

**运行环境：** 云端（AWS EC2 / ECS）或本地（通过 Cloudflare Tunnel 暴露）

**技术栈：** Bun + Hono (HTTP) + Socket.IO (实时通信) + bun:sqlite (内置持久化)

**核心职责：**
- Hono HTTP API：配对、token 刷新/吊销、会话查询/切换/版本、离线队列拉取
- Socket.IO 服务器：/relay 路由、ACK、device_list、server_state
- SQLite 持久化：会话列表、消息记录（密文）、设备信息、交付队列
- 连接状态心跳检测（pingInterval 30s / pingTimeout 90s）
- 会话运行态管理：启动屏障（warmup promise 复用）+ 引用计数 + 空闲回收
- FCM 推送通知触发（Socket.IO `register_fcm_token` + HTTP `POST /api/v1/push/register`，含 IP 限流与注册审计日志）

**服务器进程模型：**
```
Relay Server
├── Hono HTTP
│   ├── /api/v1/pair/*     ── 设备配对
│   ├── /api/v1/token/*    ── token 刷新/吊销
│   ├── /api/v1/sessions/* ── 会话查询/切换/版本
│   ├── /api/v1/queue/*    ── 离线队列拉取
│   └── /api/v1/push/*     ── FCM token 注册
├── Socket.IO
│   └── /relay 命名空间     ── CLI + App 实时通信（含 register_fcm_token）
├── SQLite
│   ├── sessions 表         ── 会话列表
│   ├── messages 表         ── 消息记录（密文）
│   └── devices 表          ── 已配对设备
└── FCM Client             ── 推送通知
```

**设计原则：**
- **零知识：** 服务器只存储密文，无法解密任何代码内容
- **可恢复：** bun:sqlite 持久化会话和消息，断线重连后可补发
- **轻量部署：** 单进程、单命令启动，支持 Docker 自部署

**部署方式：**

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| 云服务器 | AWS EC2 / ECS / 任意 VPS | 稳定在线，多用户 |
| Cloudflare Tunnel | 本地运行 + `cloudflared` 暴露 | 无需公网 IP，零成本自部署 |
| Docker | `docker run yuanio-relay` | 一键部署 |

### 2.4 Android App

**运行环境：** Android 8.0+ (API 26+)

**核心页面：**

| 页面 | 功能 |
|------|------|
| 配对页 | 扫码或输入配对码连接电脑 |
| 对话页 | 发送 prompt，查看 AI 回复（Markdown 渲染） |
| 状态页 | 实时查看 Claude Code 工具调用和执行状态 |
| Diff 页 | 查看文件变更，审批/拒绝修改 |
| 设置页 | 连接管理、通知偏好、加密密钥管理 |

**技术选型：**
- UI: Jetpack Compose + Material 3
- 网络: OkHttp + Socket.IO Android Client
- 序列化: JSON + Base64（与桌面端/服务器统一）
- 加密: EC(P-256) + HKDF + AES-GCM（密钥材料由 EncryptedSharedPreferences 保护）
- 推送: Firebase Cloud Messaging
- 本地存储: DataStore (配对信息、设置)

### 2.5 Web Dashboard

**运行环境：** 本地或自部署

**核心职责：**
- Hono + serveStatic 提供静态 Dashboard 页面
- 代理 daemon 控制面（`/api/daemon/*`）
- 支持 `YUANIO_DASHBOARD_BASE_PATH` 子路径部署（反向代理友好）

## 3. 核心数据流

### 3.1 发送 Prompt 流程（远程模式）

```
Android App                  Relay Server              Yuanio CLI            Claude Code
    │                            │                          │                      │
    │  1. encrypt(prompt)        │                          │                      │
    │──────────────────────────► │                          │                      │
    │                            │  2. forward(encrypted)   │                      │
    │                            │────────────────────────► │                      │
    │                            │                          │  3. decrypt prompt    │
    │                            │                          │  spawn stream-json   │
    │                            │                          │────────────────────► │
    │                            │                          │                      │
    │                            │                          │  4. 流式 JSON 输出    │
    │                            │                          │◄──────────────────── │
    │                            │  5. encrypt → forward    │                      │
    │                            │◄──────────────────────── │                      │
    │  6. decrypt → render       │                          │                      │
    │◄────────────────────────── │                          │                      │
```

### 3.2 无缝切换流程

```
本地终端                     Yuanio CLI            Android App
    │                            │                      │
    │  用户正在本地编码...        │                      │
    │  (spawn CLI 子进程)        │                      │
    │◄──────────────────────────►│                      │
    │                            │                      │
    │                            │  ← 手机发来 prompt    │
    │                            │◄─────────────────────│
    │  终端显示: "已切换到远程"   │                      │
    │  (kill CLI, spawn stream)  │                      │
    │◄────────────────────────── │                      │
    │                            │  → 流式输出转发到手机  │
    │                            │─────────────────────►│
    │                            │                      │
    │  用户按双空格               │                      │
    │──────────────────────────►│                      │
    │  终端显示: "已切换到本地"   │  → 通知手机已断开     │
    │  (重新 spawn CLI)          │─────────────────────►│
    │◄────────────────────────── │                      │
```

### 3.3 设备配对流程

```
Android App                  Relay Server              Yuanio CLI/Daemon
    │                            │                          │
    │                            │  1. POST /api/v1/pair/create │
    │                            │◄──────────────────────── │
    │                            │  ← pairingCode + sessionToken │
    │                            │────────────────────────► │
    │                            │                          │
    │  2. POST /api/v1/pair/join │                          │
    │     (code)                 │                          │
    │──────────────────────────► │                          │
    │                            │  3. 交换公钥              │
    │                            │◄────────────────────────►│
    │  ← agentPublicKey          │                          │
    │◄────────────────────────── │                          │
    │                            │                          │
    │  4. 双方用对方公钥建立 E2E  │                          │
```

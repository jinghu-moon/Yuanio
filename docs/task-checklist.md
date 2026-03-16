# Yuanio 任务清单

> 备注：relay-server 已迁移至 `crates/relay-server`，`crates/relay-server` 已移除。

> 最后更新：2026-02-25
> 本文档是项目进度的唯一事实来源。基于 Happy/HAPI/Claude Code/Codex 源码分析校准。

---

## Phase 0：技术验证 ✅ 已完成

**目标：** 跑通核心链路 — 手机发 prompt → 中继 → CLI 执行 Claude Code → 流式结果返回

### 基础设施

- [x] Monorepo 搭建（Bun workspaces: `packages/*`）
- [x] `@yuanio/relay-server` 包初始化
- [x] `@yuanio/cli` 包初始化

### 中继服务器原型

- [x] Bun + Hono HTTP 服务器（端口 3000）
- [x] `GET /health` 健康检查
- [x] `POST /sessions` 创建会话
- [x] `GET /sessions/:id` 获取会话消息
- [x] bun:sqlite 数据层（`sessions` + `messages` 表）
- [x] Socket.IO 双命名空间（`/app` + `/cli`）消息路由
- [x] 手机端 `prompt` 事件 → 转发 CLI `execute` 事件
- [x] CLI `message` 事件 → 转发手机端

### CLI 原型

- [x] Socket.IO 客户端连接中继服务器
- [x] `--server` / `--session` 命令行参数
- [x] `spawnClaude()` — `spawn claude -p <prompt> --output-format stream-json --verbose`
- [x] 逐行解析 JSON 流输出，提取 `assistant` 类型消息
- [x] 流式回传到中继服务器
- [x] 完成信号（`done: true`）发送

### E2E 测试脚本

- [x] 模拟手机端：连接 `/app` → 发送 prompt → 接收流式回复
- [x] 超时退出机制（60s）

### 验证结论

- [x] `spawn claude -p ... --output-format stream-json` 可靠工作
- [x] Claude SDK（`@anthropic-ai/claude-code`）不可用 → 确认使用 spawn 方案
- [x] Socket.IO 长连接稳定
- [x] ~~Android 原型~~ — 推迟到 Phase 2，用 E2E 脚本模拟
- [x] ~~双模式切换原型~~ — 移至 Phase 1 实现

### 设计文档

- [x] `docs/architecture.md` — 四组件架构设计
- [x] `docs/protocol.md` — 通信协议与 API 设计（含 Phase 1/3 实现状态标注）
- [x] `docs/security.md` — 安全设计 + 竞品加密方案对比
- [x] `docs/competitive-analysis.md` — 竞品深度对比（Happy/HAPI/Claude Code/Codex 源码验证）
- [x] `docs/tech-reference.md` — 竞品技术实现参考（含插件系统、沙箱、多模型分析）
- [x] `docs/mvp-roadmap.md` — MVP 路线图

---

## Phase 1：MVP 核心功能 ✅ 已完成

**目标：** 原型升级为可日常使用的最小产品 — 设备配对、E2E 加密、双模式切换、协议规范化

### Step 1：共享加密模块 `@yuanio/shared`

- [x] `packages/shared/package.json`（依赖: tweetnacl, tweetnacl-util）
- [x] `src/types.ts` — 共享类型
  - [x] `MessageType` 枚举（PROMPT/STREAM_CHUNK/STREAM_END/ACK/TOOL_CALL/FILE_DIFF/APPROVAL_REQ/STATUS/HEARTBEAT/PTY_* 等）
  - [x] `DeviceRole`（agent / app）、`DeviceInfo`、`Envelope`、配对相关接口
- [x] `src/crypto.ts` — TweetNaCl box（Curve25519 + XSalsa20-Poly1305）
  - [x] `generateKeyPair()` — X25519 密钥对，Base64 编码
  - [x] `deriveSharedKey()` — DH 共享密钥（box.before）
  - [x] `encrypt()` — nacl.box.after，nonce(24B) + ciphertext → Base64
  - [x] `decrypt()` — nacl.box.open.after 解密
- [x] `src/crypto-web.ts` — WebCrypto ECDH(P-256)+HKDF+AES-GCM（CLI/Daemon 生产路径）
- [x] `src/envelope.ts` — `createEnvelope()` / `openEnvelope()`
- [x] `src/envelope-web.ts` — `createEnvelopeWeb()` / `openEnvelopeWeb()`（含 AAD）
- [x] `src/index.ts` — barrel export

### Step 2：Relay Server — 数据库 + 配对 API

- [x] `src/db.ts` — 新增 `devices` 表 + `pairing_requests` 表
- [x] `src/pair.ts` — 配对码生成（XXX-XXX 格式）+ UUID token/deviceId
- [x] `POST /api/v1/pair/create` — CLI 上传公钥 → pairingCode + sessionToken + deviceId
- [x] `POST /api/v1/pair/join` — App 配对码 + 公钥 → agentPublicKey + sessionToken + deviceId
- [x] `GET /api/v1/pair/status/:code` — 轮询配对状态

### Step 3：Relay Server — Socket.IO `/relay` 统一命名空间

- [x] 删除 `/cli` + `/app` 双命名空间 → 统一 `/relay`
- [x] 认证中间件：token → device 查找 → socket.data 注入
- [x] 自动加入 session room
- [x] `message` 事件：信封路由（零知识，不解析 payload）
- [x] `device:online` / `device:offline` 事件
- [x] `device_list` 事件（在线设备列表）

### Step 4：CLI — 配对 + 密钥管理

- [x] `src/keystore.ts` — `~/.yuanio/keys.json`（mode 0o600）
- [x] `src/pair.ts` — 生成密钥 → POST /api/v1/pair/create → 显示配对码 → 轮询 → DH → 持久化

### Step 5：CLI — 双模式循环

- [x] `src/relay-client.ts` — RelayClient 类（/relay 连接、send/onMessage/onDeviceOnline）
- [x] `src/mode-switch.ts` — 双空格检测（stdin rawMode, 300ms 间隔）
- [x] `src/local.ts` — 本地模式（spawn claude, stdio inherit）
- [x] `src/remote.ts` — 远程模式（监听加密 prompt → 解密 → spawn stream-json → 加密回传）
- [x] `src/index.ts` — 双模式入口（`--server` / `--pair`，双空格切换）

### Step 6：E2E 测试脚本

- [x] `src/test-e2e.ts` — 完整加密流程模拟
  - [x] `--pairing-code` / `--server` / `--prompt` 参数
  - [x] POST /api/v1/pair/join → DH → 连接 /relay → 加密发送 → 解密接收 → 验证
  - [x] `device:online` 事件 + 3s 兜底超时（修复时序竞态）

### 测试验证

- [x] Relay Server `/health` → `{"status":"ok"}`
- [x] CLI `--pair` → 显示配对码 → E2E 脚本加入 → DH 成功
- [x] 加密 prompt → CLI 解密 → spawn claude → 流式加密回传 → E2E 解密 → `✅ 完成`

---

## Phase 2：Android App + Daemon ✅ 已完成

**目标：** 真正的手机端 + 后台进程，替代 E2E 测试脚本

### 2.1 Android 项目初始化

- [x] Kotlin + Jetpack Compose + Material 3 项目搭建
- [x] Gradle 配置（minSdk 26, targetSdk 34）
- [x] MVVM 架构 + Navigation Compose 路由
- [x] 依赖引入：OkHttp、Socket.IO Android Client、BouncyCastle（HKDF + 加密）

### 2.2 配对页

- [x] 配对码输入 UI（XXX-XXX 格式，6 位数字键盘）
- [x] `POST /api/v1/pair/join` 调用
- [x] ECDH(P-256) 密钥生成 + HKDF(SHA-256) 派生（AES-GCM 密钥）
- [x] 密钥持久化到 EncryptedSharedPreferences（MasterKey AES256_GCM）
- [x] 配对状态处理（成功/失败/超时/网络错误）

### 2.3 对话页

- [x] 消息输入框 + 发送按钮
- [x] Socket.IO 连接 `/relay`（token 认证）
- [x] 加密 prompt → Envelope → 发送
- [x] 接收 STREAM_CHUNK → 解密 → 实时渲染
- [x] 接收 STREAM_END → 标记完成
- [x] 消息气泡 UI（用户/AI 区分）
- [x] 基础 Markdown 渲染（代码块 + 粗体/斜体）

### 2.4 连接管理

- [x] 连接状态指示器（在线/离线/重连中）
- [x] 断线自动重连（Socket.IO 内置指数退避）
- [x] Agent 上线/离线通知 Toast（Snackbar）

### 2.5 安全

- [x] App 启动生物识别/PIN 验证（BiometricPrompt + DEVICE_CREDENTIAL）
- [x] 截屏保护（FLAG_SECURE）默认开启

### 2.6 Daemon 后台进程

- [x] `yuanio daemon start` / `stop` / `status` 子命令
- [x] Windows: `spawn` + `detached: true`（无 fork()）
- [x] macOS/Linux: `spawn` + `detached` + `unref()`
- [x] 维护会话 ID 列表，支持 `--resume`
- [x] CLI 未运行时代收消息并缓存
- [x] 与中继服务器保持长连接（CLI 退出后不断开）
- [x] 状态文件：`~/.yuanio/daemon.json`（PID + 端口 + 版本）

### 2.7 CLI 增强

- [x] 会话恢复（`--resume <session-id>` / `--continue`）
- [x] 远程模式终端只读状态显示（参考 Happy 的 "远程控制中" 提示）
- [x] 错误处理与用户友好提示

---

## Phase 3：协议完善 + 体验优化（基本完成 — 仅 FCM 推送待 Firebase 配置）

**目标：** 通信可靠性、协议规范化、高级功能

### 3.1 消息可靠性

- [x] 消息 UUID v7（`id` 字段）— 去重
- [x] 消息序列号（`seq` 字段）— 保证顺序
- [x] 信封格式升级：`header` 对象 → 扁平字段（对齐 protocol.md Phase 3 规范）
- [x] 关键消息 ACK 机制（当前仅 prompt；5s 超时重发，最多 3 次）
- [x] 自定义心跳（30s 间隔，90s 超时判定断开）
- [x] 断线重连 + 离线消息补发

### 3.2 新消息类型

- [x] `tool_call` — 工具调用事件（名称 + 参数 + 状态）
- [x] `file_diff` — 文件变更（path + unified diff + action）
- [x] `approval_req` / `approval_resp` — 审批请求/响应
- [x] `status` — 状态同步（idle / running / waiting_approval / error）
- [x] `heartbeat` — 心跳状态（status + uptime）
- [x] `hook_event` — hook 事件透传
- [x] `session_switch` / `session_switch_ack` — 会话切换
- [x] `pty_*` — PTY 终端消息（spawn/input/output/resize/exit/kill/ack/status）

### 3.3 Android App — 高级功能

- [x] 完整 Markdown 渲染（代码块语法高亮 — 关键字/字符串/注释着色 + 语言标签）
- [x] 文件 Diff 查看页（unified diff 渲染，红绿高亮）
- [x] 审批请求 UI（描述 + 受影响文件 + 批准/拒绝按钮）
- [x] 工具调用状态可视化（进度指示 + 工具名称）
- [x] 对话历史本地持久化（EncryptedSharedPreferences 加密存储）
- [x] 多项目切换支持（KeyStore 多 profile + 项目名称输入）
- [x] FCM 推送通知（任务完成/审批请求）— 功能已落地；部署时需配置 Firebase 凭据启用

### 3.4 Relay Server 增强

- [x] JWT session token（有效期 24h，支持主动吊销）— 替换当前 UUID token
- [x] 配对码速率限制（同一 IP 每分钟最多 5 次）
- [x] FCM token Socket.IO 注册（`register_fcm_token`）
- [x] `POST /api/v1/push/register` API（Bearer 鉴权 + 与 Socket 注册逻辑统一）
- [x] 消息密文持久化到 SQLite（异步批量写入）
- [x] 连接元数据日志（设备 ID、连接时间、IP — 仅调试用）
- [x] 乐观并发控制（参考 HAPI 的 `expectedVersion` 模式）

### 3.5 CLI 增强

- [x] Hook 服务器集成（参考 Happy 本地模式 — `--settings` 注入 Hook 配置监听 Claude 事件）
- [x] ~~远程模式升级为 Claude SDK~~ — v2.1.50 仅暴露 CLI bin，无可编程 API，继续使用 spawn 方案
- [x] 配对码速率限制客户端提示

---

## Phase 4：社区发布（基本完成 — 仅 F-Droid 待配置）

**目标：** 开源发布，建立社区

### 4.1 仓库整理

- [x] README.md（项目介绍 + 快速开始 + 架构图 + 截图）
- [x] CONTRIBUTING.md（贡献指南 + 开发环境搭建）
- [x] LICENSE（MIT）
- [x] CHANGELOG.md

### 4.2 CI/CD

- [x] GitHub Actions 工作流
  - [x] Lint + Type Check（Bun + TypeScript）
  - [x] E2E 集成测试（启动 relay → CLI → e2e 脚本）
  - [x] 构建产物发布（npm publish + Docker push）

### 4.3 发布包

- [x] `npm install -g yuanio` — CLI 全局安装
- [x] Relay Server Docker 镜像（`docker run yuanio-relay`）
- [x] Cloudflare Tunnel 一键部署文档
- [x] Android APK（debug 构建，release 签名待配置）
- [x] F-Droid 发布准备 — release 签名与 metadata 模板已配置（等待 F-Droid Data PR 审核）

---

## 项目结构

### 当前（截至 2026-02-25）

```
yuanio/
├── package.json                          # Monorepo root (Bun workspaces)
├── docs/
│   ├── architecture.md                   # 系统架构设计
│   ├── protocol.md                       # 通信协议（✅/🔲 状态标注）
│   ├── security.md                       # 安全设计 + 竞品加密对比
│   ├── competitive-analysis.md           # 竞品深度分析（源码验证）
│   ├── tech-reference.md                 # 竞品技术实现参考
│   ├── mvp-roadmap.md                    # MVP 路线图
│   └── task-checklist.md                 # 本文档
├── packages/
│   ├── shared/                           # @yuanio/shared
│   │   └── src/
│   │       ├── index.ts                  # barrel export
│   │       ├── types.ts                  # MessageType, Envelope, DeviceInfo...
│   │       ├── crypto.ts                 # TweetNaCl box 实现
│   │       ├── crypto-web.ts             # WebCrypto AES-GCM 实现
│   │       ├── envelope.ts               # createEnvelope, openEnvelope
│   │       └── envelope-web.ts           # createEnvelopeWeb, openEnvelopeWeb
│   ├── relay-server/                     # @yuanio/relay-server
│   │   └── src/
│   │       ├── index.ts                  # Hono HTTP + Socket.IO /relay
│   │       ├── db.ts                     # bun:sqlite (sessions, messages, devices, pairing_requests)
│   │       └── pair.ts                   # 配对码生成 + UUID 工具
│   └── cli/                              # @yuanio/cli
│       └── src/
│           ├── index.ts                  # 双模式入口
│           ├── spawn.ts                  # Claude 进程执行器（stream-json）
│           ├── pair.ts                   # 配对流程
│           ├── keystore.ts               # ~/.yuanio/keys.json 持久化
│           ├── relay-client.ts           # Socket.IO /relay 客户端
│           ├── remote.ts                 # 远程模式
│           ├── local.ts                  # 本地模式
│           ├── mode-switch.ts            # 双空格检测
│           └── test-e2e.ts              # E2E 测试脚本
│   └── web-dashboard/                    # 静态 Dashboard（Hono）
└── refer/                                # 竞品源码参考（不纳入构建）
    ├── happy-main/                       # Happy 源码
    ├── hapi-main/                        # HAPI 源码
    ├── claude-code-main/                 # Claude Code 插件仓库
    └── codex-main/                       # Codex 源码
```

### 包依赖

```
@yuanio/shared        ← tweetnacl, tweetnacl-util
@yuanio/relay-server  ← @yuanio/shared, hono, socket.io
@yuanio/cli           ← @yuanio/shared, socket.io-client, tweetnacl, tweetnacl-util
@yuanio/web-dashboard ← hono, @hono/node-server
```

---

## 竞品对标（源码验证）

> 基于 Phase 0 竞品源码深度分析，指导后续开发优先级

| 能力 | Happy | HAPI | Yuanio 现状 | 差距 |
|------|-------|------|--------------|------|
| E2E 加密 | ✅ 双变体 | ❌ 无 | ✅ AES-GCM + NaCl 兼容 | 无 |
| 本地模式 | spawn CLI + Hook | spawn CLI | ✅ spawn CLI inherit + Hook | 无 |
| 远程模式 | Claude SDK | Claude SDK | ✅ spawn stream-json + Adapter | 可扩展 |
| 双模式切换 | ✅ 双空格 | ❌ 无 | ✅ 双空格 | 已对齐 |
| 移动端 | Expo 跨平台 | React PWA | ✅ Android 原生 | iOS 未覆盖 |
| Daemon | ✅ 自动启动 | ✅ Runner | ✅ daemon | 无 |
| 审批流程 | ✅ SDK 回调 | ✅ RPC | ✅ hook + approval | 无 |
| 多 Agent | Claude + Codex | 4 种 | 🟡 claude/codex/gemini 适配 | 可用性待验证 |
| 消息可靠性 | seq + 重试 | 版本控制 | ✅ seq + ACK + 离线补发 | 无 |

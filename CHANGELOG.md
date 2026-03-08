# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Phase 0 — 技术验证
- Monorepo 搭建（Bun workspaces）
- 中继服务器原型（Hono + Socket.IO）
- CLI 原型（spawn claude stream-json）
- E2E 测试脚本验证核心链路

### Phase 1 — MVP 核心功能
- `@yuanio/shared` 加密模块（TweetNaCl SecretBox）
- 设备配对流程（XXX-XXX 配对码 + X25519 DH）
- Socket.IO `/relay` 统一命名空间（零知识信封路由）
- CLI 双模式切换（本地 ↔ 远程，双空格触发）
- 密钥持久化（~/.yuanio/keys.json）

### Phase 2 — Daemon + CLI 增强
- `yuanio daemon start/stop/status` 后台进程
- 会话恢复（`--resume` / `--continue`）
- 远程模式终端只读状态显示
- 错误处理与用户友好提示

### Phase 3 — 协议完善 + 体验优化
- 消息 UUID v7 + 序列号 + ACK 机制
- 自定义心跳（30s/90s）+ 断线重连 + 离线消息补发
- 新消息类型：tool_call / file_diff / approval_req / approval_resp / status
- JWT session token（24h 有效期 + 主动吊销）
- 配对码速率限制（5 次/分钟/IP）
- 消息密文持久化到 SQLite
- 连接元数据日志
- 乐观并发控制
- Hook 服务器集成（Claude SessionStart 事件监听）
- 配对码速率限制客户端提示

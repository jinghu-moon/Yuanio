# 竞品分析

> 基于 Happy / HAPI / Claude Code / Codex 完整源码深度分析
> 最后更新：2026-02-25

## 核心竞品

### Happy (slopus/happy)

- **仓库：** github.com/slopus/happy
- **定位：** Claude Code / Codex 的移动端和 Web 客户端
- **架构：** 云中心化（Fastify + Socket.IO + Prisma 后端）
- **移动端：** Expo 54 + React Native 0.81 跨平台（iOS + Android + Web + macOS Tauri 桌面）
- **CLI：** `happy` 替代 `claude`，包装器模式，双模式循环（本地 spawn CLI / 远程 Claude SDK）
- **加密：** 双变体 E2E — Legacy (TweetNaCl SecretBox) + DataKey (AES-256-GCM + 临时密钥对)
- **核心特性：** 无缝切换本地/远程、Hook 服务器监听 Claude 事件、Daemon 后台进程、推送通知
- **协议：** MIT

**源码验证的关键架构：**
- **5 个包**：happy-wire（协议）、happy-cli（CLI）、happy-app（移动端）、happy-agent（远程代理）、happy-server（后端）
- **本地模式**：`spawn("node", [claudeCliPath, ...], { stdio: ["inherit","inherit","inherit","pipe"] })` — fd3 用于 Hook 事件回调
- **远程模式**：`import { claude } from '@anthropic-ai/claude-code'` — 直接调用 Claude SDK 程序化 API
- **密钥交换**：libsodium `box()` + 临时密钥对，`[ephemeralPubKey(32) | nonce(24) | encrypted]`
- **认证**：Ed25519 签名挑战-响应，QR 码包含 base64url 编码的密钥

**优势：**
- 产品成熟度最高，已上架应用商店
- 跨平台覆盖全（iOS + Android + Web + macOS 桌面）
- 双加密变体（Legacy + DataKey），安全性最强
- Daemon 自动启动，支持远程生成新会话

**劣势：**
- 后端部署复杂（需要多个服务）
- Expo 跨平台 App 体验不如原生
- 云中心化架构，数据经过第三方服务器（虽然加密）
- Claude SDK (`@anthropic-ai/claude-code`) 可能非公开 API，存在兼容性风险

### HAPI (tiann/hapi)

- **仓库：** github.com/tiann/hapi
- **定位：** Happy 的本地优先替代品（"哈皮"）
- **架构：** 去中心化（用户自建 Hub，Fastify + Socket.IO + bun:sqlite）
- **移动端：** React 19 Web PWA（TanStack Router + xterm.js 终端）+ Telegram Mini App
- **CLI：** `hapi` 替代 `claude`，包装器模式，多 Agent 注册表
- **加密：** **无 E2E 加密**（直连模式，仅 TLS + Token 认证）
- **核心特性：** 多 Agent（Claude/Codex/Gemini/OpenCode）、RPC 网关、终端共享、Web Push
- **远程方案：** Cloudflare Tunnel / Tailscale / 内置 Relay

**源码验证的关键架构：**
- **4 个包**：cli、hub、web、shared（@hapi/protocol，Zod 验证）
- **SyncEngine 核心**：SessionCache + MachineCache + MessageService + RpcGateway
- **双命名空间**：`/cli`（CLI_API_TOKEN 认证）+ `/terminal`（JWT 认证）
- **乐观并发控制**：`expectedVersion` 字段防止状态冲突
- **认证**：`constantTimeEquals()` 防时序攻击 + jose JWT
- **会话保活**：每 30s 发送 `session-alive` 事件（含 thinking/mode/permissionMode 状态）
- **远程生成会话**：`rpcGateway.spawnSession(machineId, directory, agent, model, ...)`

**优势：**
- 部署极简，`npx @twsxtd/hapi` 一条命令
- 数据完全本地，不经过任何第三方
- 支持 AI Agent 种类最多（4 种）
- RPC 网关模式，支持远程文件浏览、ripgrep 搜索、Git 操作
- 终端共享（xterm.js），可远程查看 CLI 终端

**劣势：**
- **无 E2E 加密**（数据以 JSON 明文存储在 Hub SQLite 中）
- 无原生移动 App，PWA 体验有限
- 自建 Hub 需要用户有一定技术能力
- 远程访问依赖隧道方案，配置门槛较高

### Claude Code (Anthropic)

- **仓库：** github.com/anthropics/claude-code
- **定位：** Anthropic 官方 AI 编程 CLI
- **架构：** 单进程 CLI + 插件生态（npm 二进制分发）

**源码验证的关键架构：**
- **开源部分为插件仓库**，主 CLI 作为 `@anthropic-ai/claude-code` npm 包二进制分发
- **插件系统**：commands（斜杠命令）、agents（专门化代理）、skills（可复用技能）、hooks（事件处理器）、MCP（外部工具）
- **Hook 事件**：`SessionStart`、`PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`Stop`
- **MCP 传输**：stdio、HTTP、SSE 三种模式
- **输出格式**：`--output-format stream-json` 提供 JSONL 流式结构化输出
- **会话管理**：`--resume <session-id>` / `--continue` 恢复会话

**对 Yuanio 的启示：**
- Hook 系统是 Happy 本地模式的基础（通过 `--settings` 注入 Hook 配置）
- `stream-json` 是 Yuanio Phase 1 远程模式的核心接口
- 插件系统可作为未来扩展参考

### Codex (OpenAI)

- **仓库：** github.com/openai/codex
- **定位：** OpenAI 官方 AI 编程 CLI
- **架构：** TypeScript 包装 + Rust 核心（混合语言）

**源码验证的关键架构：**
- **双层架构**：`codex-cli`（Node.js 入口，平台检测 + spawn Rust 二进制）+ `codex-rs`（40+ Rust crate）
- **TUI**：Ratatui 框架，`chatwidget.rs`(305KB)、`app.rs`(185KB) 等大型模块
- **沙箱系统**：macOS Seatbelt、Linux Landlock、Windows Sandbox 三平台隔离
- **执行策略**：`exec_policy.rs` — 前缀规则 + 启发式规则，`AskForApproval` 枚举控制审批级别
- **多模型**：OpenAI Responses API、WebSocket V2、Ollama、LM Studio、自定义 API
- **会话管理**：`~/.codex/sessions/` JSONL 持久化，支持 resume/fork
- **app-server-protocol**：JSON Schema 定义事件消息（EventMsg.json 219KB）
- **工具系统**：shell、read_file、list_dir、grep_files、apply_patch、view_image、js_repl、MCP、multi_agent

**对 Yuanio 的启示：**
- 沙箱系统是安全执行的标杆，Yuanio 未来可参考
- 事件驱动架构 + JSON Schema 协议定义值得借鉴
- 多模型支持是差异化方向（Yuanio 可扩展支持 Codex）

---

## Yuanio 差异化定位

| 维度 | Happy | HAPI | Yuanio |
|------|-------|------|----------|
| 移动端 | Expo 跨平台 (iOS/Android/Web/macOS) | React PWA + Telegram Mini App | **Android 原生 (Kotlin)** |
| 后端 | Fastify + Prisma 多服务 | Fastify + bun:sqlite 自建 Hub | **Bun + Hono + bun:sqlite 中继** |
| 数据模型 | 云存储（E2E 加密） | 本地存储（**无加密**） | **零知识转发（E2E 加密）** |
| E2E 加密 | TweetNaCl + AES-256-GCM 双变体 | ❌ 无（仅 TLS） | WebCrypto AES-GCM + NaCl 兼容 |
| Claude 集成 | SDK (远程) + spawn+Hook (本地) | SDK + spawn | spawn stream-json (远程) + spawn inherit (本地) |
| 多 Agent | Claude + Codex | Claude + Codex + Gemini + OpenCode | claude/codex/gemini 适配 |
| 部署难度 | 高（多服务） | 中（自建 Hub + 隧道） | **低（npm install + 扫码）** |
| 会话管理 | Daemon 后台 + 远程 spawn | Runner 后台 + RPC spawn | Daemon 已实现 |

### 核心差异点

1. **Android 原生体验** — Happy 用 Expo 跨平台，体验是妥协的；HAPI 用 PWA，功能受限。Yuanio 用 Jetpack Compose 原生开发，可深度集成 Android 特性（通知渠道、桌面小组件、Tasker 集成等）

2. **零知识中继 + E2E 加密** — Happy 虽有 E2E 加密但数据经过云服务器；HAPI 完全无加密（直连模式）。Yuanio 的中继服务器只做加密信封路由，不解析 payload，兼顾便利性和隐私

3. **开箱即用** — 不需要像 HAPI 那样配置隧道，也不需要像 Happy 那样部署多个服务。`npm install -g yuanio` + 手机扫码即可使用

4. **无 SDK 依赖风险** — Happy 远程模式依赖 `@anthropic-ai/claude-code` SDK（可能非公开 API）。Yuanio 使用 `spawn claude -p --output-format stream-json`，这是 Claude Code 官方支持的稳定接口

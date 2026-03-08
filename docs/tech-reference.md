# 竞品技术实现参考（源码版）

> 基于 Happy / HAPI / Claude Code / Codex 完整源码分析
> ⚠️ 本文档替代之前基于编译产物的推测版本，已纠正多处关键错误

## 重要纠正

| 之前的错误假设 | 源码揭示的事实 |
|---------------|---------------|
| Claude Code 通过 fd3 输出 JSONL 事件 | fd3 是 Happy 自己的 Hook 机制，非 Claude Code 原生接口 |
| Happy 远程模式包装 CLI stdout | Happy 远程模式使用 **Claude SDK** (`@anthropic-ai/claude-code`) |
| HAPI 是原生二进制看不到源码 | HAPI 源码是 TypeScript，编译为二进制发布 |
| 中继服务器只做消息转发 | HAPI Hub 是完整服务器（Hono HTTP + Socket.IO + SQLite） |

## 1. Happy 双模式架构（核心发现）

Happy 的 Claude 集成有**两种完全不同的模式**，不是一种：

### 1.1 本地模式 — spawn CLI 子进程

```
源码：packages/happy-cli/src/claude/claudeLocal.ts
```

```typescript
// 本地模式：spawn claude 子进程，stdin/stdout/stderr 全部 inherit
// 用户在终端正常交互，Happy 通过 Hook 服务器监听事件
spawn("node", [claudeCliPath, ...claudeArgs], {
  stdio: ["inherit", "inherit", "inherit", "pipe"],  // fd3 用于 Hook 事件
  cwd: projectDir
});

// 传递的关键参数：
// --append-system-prompt  注入系统提示
// --mcp-config            MCP 服务器配置
// --allowedTools          允许的工具列表
// --settings              Hook 设置路径（指向 Happy 的 Hook 服务器）
```

**本地模式的 fd3**：是 Happy 自己注入的 Hook 设置让 Claude Code 回调 Happy 的 HTTP 服务器，不是 Claude Code 原生的 fd3 输出。

### 1.2 远程模式 — 使用 Claude SDK

```
源码：packages/happy-cli/src/claude/claudeRemote.ts
```

```typescript
// 远程模式：不启动 CLI 子进程，而是直接调用 Claude SDK
import { claude } from '@anthropic-ai/claude-code';

// SDK 提供程序化 API，支持：
// - 发送消息
// - 接收流式输出
// - 权限审批回调 (canCallTool)
// - 会话恢复 (--resume)
```

**这是关键区别**：远程模式完全绕过了 CLI，用 SDK 直接与 Claude Code 引擎交互。

### 1.3 模式切换循环

```
源码：packages/happy-cli/src/claude/loop.ts
```

```
启动 → 判断 startingMode
         ↓
    ┌─ local ──→ claudeLocalLauncher() ──→ spawn CLI 子进程
    │                                        用户在终端交互
    │                                        ↓ 手机发来消息
    │                                        exitReason = "switch"
    │                                        ↓
    └─ remote ─→ claudeRemoteLauncher() ──→ 调用 Claude SDK
                                             手机控制
                                             ↓ 用户按双空格
                                             exitReason = "switch"
                                             ↓
                                        回到循环顶部，切换模式
```

**双空格检测**（远程模式下）：
```typescript
// claudeRemoteLauncher.ts
process.stdin.setRawMode(true);
// 监听键盘输入，双空格 → onSwitchToLocal()
// Ctrl-C → onExit()
```

## 2. HAPI 真实架构（源码揭示）

HAPI 不是"原生二进制看不到源码"——它是 TypeScript 项目，编译后发布为平台二进制。

### 2.1 三端结构

```
hapi-main/
├── cli/     ← CLI 包装器（TypeScript，编译为二进制）
├── hub/     ← 中继服务器（TypeScript，Hono + Socket.IO + SQLite）
├── web/     ← Web 前端（React + Vite + Tailwind）
└── shared/  ← 共享类型定义
```

### 2.2 Hub 服务器架构

```
源码：hapi-main/hub/src/
```

```
Hub 进程
├── Hono HTTP 服务器
│   ├── /cli/sessions      ← 会话 CRUD
│   ├── /cli/messages      ← 消息收发
│   ├── /cli/machines      ← 设备管理
│   ├── /cli/permissions   ← 权限审批
│   └── /events/stream     ← SSE 事件流（Web 前端用）
├── Socket.IO 服务器
│   ├── /cli 命名空间       ← CLI 客户端连接（CLI_API_TOKEN 认证）
│   └── /terminal 命名空间  ← Web 终端会话（JWT 认证）
├── SyncEngine（核心）
│   ├── SessionCache       ← 会话内存缓存
│   ├── MachineCache       ← 设备内存缓存
│   ├── MessageService     ← 消息路由
│   └── RpcGateway         ← RPC 转发
├── 通知系统
│   ├── Web Push           ← PWA 推送
│   ├── Telegram Bot       ← Telegram 通知
│   └── SSE Manager        ← 实时事件流
└── SQLite 数据库
    ├── sessions 表
    ├── messages 表
    ├── machines 表
    ├── users 表
    └── push_subscriptions 表
```

### 2.3 HAPI CLI 命令系统

```
源码：hapi-main/cli/src/commands/registry.ts
```

```typescript
// 命令注册表 — 默认命令是 claude
const COMMANDS = [
  authCommand,        // hapi auth login
  connectCommand,     // hapi connect
  claudeCommand,      // hapi (默认) → runClaude()
  codexCommand,       // hapi codex → runCodex()
  geminiCommand,      // hapi gemini → runGemini()
  opencodeCommand,    // hapi opencode → runOpencode()
  hubCommand,         // hapi hub → 启动本地 Hub
  mcpCommand,         // hapi mcp
  doctorCommand,      // hapi doctor
  runnerCommand,      // hapi runner → 后台服务
  notifyCommand       // hapi notify
]

// 无子命令时默认执行 claudeCommand
const resolvedCommand = command ?? claudeCommand;
```

### 2.4 HAPI 与 Happy 的关键架构差异

| 维度 | Happy | HAPI |
|------|-------|------|
| 服务器 | 云托管 (cluster-fluster.com) | **用户自建 Hub** |
| 数据库 | PostgreSQL + Redis | **SQLite（嵌入式）** |
| Web 框架 | 未知（闭源服务端） | **Hono**（轻量） |
| 实时通信 | Socket.IO | **Socket.IO + SSE** |
| 认证 | 临时密钥对 + 轮询 | **CLI_API_TOKEN + JWT** |
| 远程 Claude | Claude SDK | **同样支持 SDK + CLI** |
| 部署 | 需要多服务 | **单命令 `hapi hub`** |

## 3. Claude Code 集成方式选择（关键决策）

源码分析揭示了三种可行的集成方式：

### 方式 A：Claude SDK（Happy 远程模式）

```typescript
// @anthropic-ai/claude-code 提供程序化 API
import { claude } from '@anthropic-ai/claude-code';
// 直接调用，无需 spawn 子进程
```

**优点：** 结构化输出、权限回调、无需解析文本
**缺点：** SDK 可能不公开或变更频繁、与本地 CLI 体验不一致

### 方式 B：spawn CLI + Hook 服务器（Happy 本地模式）

```typescript
// spawn claude 子进程，通过 --settings 注入 Hook 配置
// Hook 服务器监听 Claude Code 的事件回调
spawn("node", [claudeCliPath,
  "--settings", hookSettingsPath,  // Hook 回调地址
  "--append-system-prompt", prompt
], { stdio: ["inherit", "inherit", "inherit", "pipe"] });
```

**优点：** 用户体验与原生 CLI 一致、不依赖非公开 SDK
**缺点：** Hook 事件有限、无法完全控制输出流

### 方式 C：--output-format=stream-json（Claude Code 原生）

```bash
# Claude Code 支持的官方流式 JSON 输出
claude -p "prompt" --output-format=stream-json
```

**优点：** 官方支持的接口、结构化 JSON 输出、无需 SDK 依赖
**缺点：** 仅限 print 模式（非交互式）、不支持本地终端交互

### Yuanio 建议：混合方案

```
本地模式 → 方式 B（spawn CLI + Hook）
远程模式 → 方式 A（Claude SDK）或方式 C（stream-json）
```

这也是 Happy 验证过的方案。

## 4. 通信与加密（源码确认）

### 4.1 Happy 加密实现

```
源码：packages/happy-cli/src/api/encryption.ts
```

- **TweetNaCl SecretBox**：对称加密（XSalsa20-Poly1305）
- **TweetNaCl Box + AES-256-GCM**：混合加密（DataKey 模式）
- 所有消息 Base64 编码后通过 Socket.IO 传输
- 消息序列号 `seq` 保证顺序

### 4.2 HAPI 认证方案

```
源码：hapi-main/hub/src/socket/server.ts
```

- CLI → Hub：`CLI_API_TOKEN` 静态令牌（constantTimeEquals 比较）
- Web → Hub：JWT（jose 库签发/验证）
- 配对码/QR 码包含 Hub 的访问 URL + 令牌

## 5. Claude Code 插件与集成架构（源码分析）

```
源码：refer/claude-code-main/
```

### 5.1 项目性质

Claude Code 开源仓库是**插件生态中心**，非主 CLI 源码。主 CLI 作为 `@anthropic-ai/claude-code` npm 包二进制分发。

### 5.2 插件系统

```
plugin-name/
├── .claude-plugin/plugin.json   # 插件元数据
├── commands/                    # 斜杠命令
├── agents/                      # 专门化代理
├── skills/                      # 可复用技能
├── hooks/                       # 事件处理器
├── .mcp.json                    # MCP 服务器配置
└── README.md
```

### 5.3 Hook 事件（Happy 本地模式的基础）

| Hook 事件 | 触发时机 | 竞品用途 |
|-----------|---------|---------|
| `SessionStart` | 会话开始 | Happy 注入系统提示 |
| `PreToolUse` | 工具调用前 | 安全检查、权限拦截 |
| `PostToolUse` | 工具调用后 | 事件监听、状态同步 |
| `UserPromptSubmit` | 用户提交前 | 输入验证 |
| `Stop` | 停止前 | 循环拦截（ralph-wiggum 插件） |

### 5.4 MCP 服务器类型

```json
{
  "mcpServers": {
    "stdio-server": { "command": "node", "args": ["server.js"] },
    "http-server": { "url": "http://localhost:3001" },
    "sse-server": { "url": "http://localhost:3002/sse" }
  }
}
```

Happy 本地模式通过 `--mcp-config` 注入 MCP 服务器，HAPI 同样使用 HTTP 类型 MCP。

## 6. Codex 架构分析（源码分析）

```
源码：refer/codex-main/
```

### 6.1 混合语言架构

```
codex-cli/ (TypeScript 包装层)
  └── bin/codex.js → 平台检测 → spawn Rust 二进制

codex-rs/ (Rust 核心，40+ crate)
  ├── cli/        → 多工具入口 (Subcommand 枚举)
  ├── core/       → 业务逻辑 (codex.rs 348KB)
  ├── tui/        → Ratatui TUI (chatwidget.rs 305KB)
  ├── exec/       → 非交互式执行
  ├── app-server/ → 应用服务器
  └── app-server-protocol/ → JSON Schema 协议定义
```

### 6.2 沙箱系统（三平台）

| 平台 | 技术 | 策略文件 |
|------|------|---------|
| macOS | Seatbelt | `.sbpl` 沙箱配置 |
| Linux | Landlock | 内核级文件系统隔离 |
| Windows | Windows Sandbox | ConPTY 进程隔离 |

### 6.3 执行策略与审批

```rust
enum AskForApproval {
    Never,           // 不询问
    OnFailure,       // 失败时询问
    OnRequest,       // 请求时询问
    UnlessTrusted,   // 除非信任
    Reject(config),  // 拒绝特定类型
}
```

规则文件：`~/.codex/rules/default.rules`，支持前缀规则和启发式规则。

### 6.4 多模型支持

```rust
enum WireApi {
    OpenaiResponses,  // OpenAI Responses API (主要)
    OpenaiChat,       // OpenAI Chat API
    OllamaChat,       // Ollama 本地
    LmStudioChat,     // LM Studio 本地
    CustomApi,        // 自定义 API
}
```

### 6.5 会话持久化

```
~/.codex/sessions/2026-02-24/session-001/
├── head.jsonl       # 会话头
├── events.jsonl     # 事件流
└── metadata.json    # 元数据
```

支持 `codex resume --last` 和 `codex fork --last`。

---

## 7. Yuanio 修正建议（基于源码）

### 7.1 已采纳（Phase 1 已实现）

1. ✅ **双模式架构** — 本地 spawn CLI（stdio inherit）+ 远程 spawn stream-json
2. ✅ **双空格切换** — 300ms 间隔检测，已验证可靠
3. ✅ **E2E 加密** — WebCrypto AES-GCM + AAD（兼容 NaCl box）
4. ✅ **统一 /relay 命名空间** — token 认证 + session room 路由
5. ✅ **Bun + Hono + Socket.IO + bun:sqlite** — 已验证技术栈
6. ✅ **消息序列号 (seq)** — 发送端递增，保障顺序
7. ✅ **Daemon 后台进程** — 会话持久化 + 远程生成新会话

### 7.2 待采纳（Phase 2+）

1. **Claude SDK 远程模式** — 可选升级以获得权限回调能力
2. **RPC 网关** — 参考 HAPI，支持远程文件浏览、Git 操作

### 7.3 需要注意的坑

1. **Claude SDK 非公开风险** — `@anthropic-ai/claude-code` SDK 可能变更，当前用 stream-json 更稳定
2. **Daemon 进程管理** — Windows 无 fork()，需 `child_process.spawn` + detach
3. **会话恢复** — Claude Code 支持 `--resume` / `--continue`，需正确管理会话 ID
4. **E2E 竞态** — Phase 1 已修复：`device:online` 事件 + 3s 兜底超时

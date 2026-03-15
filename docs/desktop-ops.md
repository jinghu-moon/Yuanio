# 桌面端运维（双地址 + Named Tunnel）

本文是 Yuanio 桌面端推荐运行方式。

## 架构

- 控制链路（桌面端）：`http://localhost:3000`
- 公网链路（手机端）：`https://relay.yourdomain.com`

CLI 配对时固定使用：

```bash
bun run packages/cli/src/index.ts --server http://localhost:3000 --public-server https://relay.yourdomain.com --namespace default --pair
```

## 一次性配置

1. 启动本地 Relay：

```bash
cargo run --manifest-path crates/relay-server/Cargo.toml
```

2. 配置并验证 Named Tunnel：

```bash
cloudflared tunnel create yuanio
cloudflared tunnel route dns yuanio relay.yourdomain.com
cloudflared tunnel run yuanio
```

3. Windows 下安装 cloudflared 服务（管理员）：

```powershell
.\scripts/install-cloudflared-service.ps1 -TunnelName "yuanio" -RelayPort 3000
```

校验服务入口是否正确：

```powershell
Get-Service "cloudflared"
sc.exe qc cloudflared
```

`sc qc` 里的 `BINARY_PATH_NAME` 应为：

```text
"<cloudflared.exe>" tunnel --config "C:/Windows/System32/config/systemprofile/.cloudflared/config.yml" run <tunnel-id>
```

4. 使用 PM2 常驻 Relay + Daemon（可选）：

```bash
bunx pm2 start scripts/pm2/ecosystem.config.cjs
bunx pm2 save --force
```

查看状态：

```bash
bunx pm2 status
bunx pm2 logs yuanio-relay
bunx pm2 logs yuanio-daemon
```

## Ink TUI 运维入口

桌面端可直接进入 Ink TUI 管控服务：

```bash
bun run packages/cli/src/index.ts launch --server http://localhost:3000
```

可选增加命名空间（多环境隔离）：

```bash
bun run packages/cli/src/index.ts launch --server http://localhost:3000 --namespace dev
```

可选指定界面语言：

```bash
bun run packages/cli/src/index.ts launch --server http://localhost:3000 --lang zh-CN
bun run packages/cli/src/index.ts launch --server http://localhost:3000 --lang zh-TW
bun run packages/cli/src/index.ts launch --server http://localhost:3000 --lang en
```

`Services` 页常用按键：

- `a`：全部启动（Relay → Tunnel → Daemon）
- `x`：全部停止
- `R`：重启当前选中服务（先停止再启动）
- `f`/`r`：刷新 cloudflared Windows 服务状态
- `i`：安装/修复 cloudflared Windows 服务（需二次确认 + 管理员权限）

全局按键（任意页）：

- `0`：重启整个 TUI（先停止当前服务，再重新加载配置与界面）
- `q`：退出 TUI

`Config` 页（按 `6` 进入）用于本地配置管理，支持修改并持久化到 `~/.yuanio/config.json`：

- 可编辑：`serverUrl`、`namespace`、`relayPort`、`autoStart`、`tunnelMode`、`tunnelName`、`tunnelHostname`、`language`
- `Enter/e`：编辑或切换当前字段
- `s`：保存配置
- `l`：从磁盘重载配置
- `d`：丢弃未保存修改

配置生效策略：

- UI 层（配对页/状态展示）会即时刷新
- 运行中的服务建议重启后再完整应用新配置

`Pair` 页继续使用公网地址配对，保持双地址架构：

- 控制链路（桌面）`http://localhost:3000`
- 公网链路（手机）`https://relay.yourdomain.com`

## 日常检查

```bash
bun run packages/cli/src/index.ts doctor --server http://localhost:3000 --public-server https://relay.yourdomain.com
```

## FCM 推送启用（可选）

Relay 侧需提供 Firebase Admin 凭据，Android 侧需集成 Firebase 配置文件。

Relay 环境变量：

```bash
# 将 Firebase service account JSON 压成单行后写入环境变量
export FCM_SERVICE_ACCOUNT='{"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","token_uri":"https://oauth2.googleapis.com/token"}'
```

可选限流参数（push token 注册）：

```bash
export YUANIO_PUSH_REGISTER_RATE_LIMIT_MAX=20
export YUANIO_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS=60000
```

Android 侧：

1. 在 Firebase 项目开启 Cloud Messaging。
2. 把 `google-services.json` 放到 `android-app/app/google-services.json`。
3. 重新构建并安装 App（首次启动会生成/刷新 FCM token）。

脚本化控制（非交互）示例：

```bash
bun run packages/cli/src/index.ts agent list --server http://localhost:3000
bun run packages/cli/src/index.ts agent history --limit 30 --server http://localhost:3000
bun run packages/cli/src/index.ts agent send --prompt "继续处理上一任务" --wait --server http://localhost:3000
```

## Telegram Webhook 控制面（可选）

用于把 Telegram 从“仅通知”升级为“可交互控制”（`/status`、`/continue`、`/stop`、`/resume`、审批按钮）。

一键脚本（Windows）：

```bash
# Cloudflare/公网模式（推荐，可直接在 Telegram 交互）
bun run telegram:start:cloudflare -- -PublicServerUrl https://relay.yourdomain.com

# LAN 模式（仅本机启动，不配置公网 webhook）
bun run telegram:start:lan

# 查看状态 / 停止
bun run telegram:status
bun run telegram:stop
```

说明：
- `cloudflare/public` 模式会设置 Telegram webhook，可直接从 Telegram 下发命令。
- `lan` 模式不会设置公网 webhook，Telegram 无法主动回调到本机；适合本地联调或仅保留通知能力。
- 一键脚本会自动注入 `YUANIO_INGRESS_NETWORK_MODE`（`lan|cloudflare|public`），供统一入口协议层识别当前网络场景。

前置条件：

- `~/.yuanio/keys.json` 中已有 `telegramBotToken` 与 `telegramChatId`
- 桌面端有一个公网 HTTPS 地址可回调到 CLI（常见做法：Cloudflare Tunnel）

建议环境变量：

```bash
# 启用 webhook 控制面
export YUANIO_TELEGRAM_WEBHOOK_ENABLED=1

# CLI 本地监听端口（默认 8787）
export YUANIO_TELEGRAM_WEBHOOK_PORT=8787

# 本地 webhook 路径（默认 /telegram/webhook）
export YUANIO_TELEGRAM_WEBHOOK_PATH=/telegram/webhook

# Telegram 回调地址（建议填完整 HTTPS URL）
export YUANIO_TELEGRAM_WEBHOOK_URL=https://relay.yourdomain.com/telegram/webhook

# 建议开启：Telegram 会在回调请求头携带该 secret
export YUANIO_TELEGRAM_WEBHOOK_SECRET=replace_with_long_random_secret

# 允许透传给 Agent 的斜杠命令（逗号分隔）
export YUANIO_TELEGRAM_FORWARD_COMMANDS=model,cost,config,permissions

# 若置为 1，放行全部未知 /command（慎用）
export YUANIO_TELEGRAM_FORWARD_ALL_COMMANDS=0

# 显式禁止透传的命令（优先级高于 allowlist）
export YUANIO_TELEGRAM_BLOCKED_COMMANDS=start,help,status,continue,continue_,stop,clear,loop,resume,approve,reject

# 透传命令名格式约束（正则）
export YUANIO_TELEGRAM_FORWARD_COMMAND_PATTERN=^[a-z][a-z0-9_:-]{0,31}$

# Telegram 实时消息刷新/typing 周期（毫秒）
export YUANIO_TELEGRAM_LIVE_INTERVAL_MS=1200
export YUANIO_TELEGRAM_TYPING_INTERVAL_MS=4000

# 统一入口协议网络模式（LAN / Cloudflare / 公网）
export YUANIO_INGRESS_NETWORK_MODE=cloudflare

# Telegram API 基址（需走镜像/网关时可改）
export YUANIO_TELEGRAM_API_BASE=https://api.telegram.org

# 退出时自动 deleteWebhook（默认开启）
export YUANIO_TELEGRAM_AUTO_DELETE_WEBHOOK=1

# 注册 webhook 时丢弃 Telegram 侧历史 pending（默认开启，避免历史重复投递）
export YUANIO_TELEGRAM_WEBHOOK_DROP_PENDING=1

# 普通文本 prompt 的“已发送”回执（默认关闭，避免聊天噪音）
export YUANIO_TELEGRAM_PROMPT_RECEIPT=0

# webhook 去重缓存 TTL（毫秒，默认 10 分钟）
export YUANIO_TELEGRAM_DEDUP_TTL_MS=600000

# Telegram 实时消息布局：
# output_first（默认，先显示输出再显示过程）| process_first
export YUANIO_TELEGRAM_LIVE_LAYOUT=output_first

# /loop 最大迭代轮数（默认 5）
export YUANIO_TELEGRAM_LOOP_MAX_ITERATIONS=5

# 启用消息 reaction（默认开启）及 emoji
export YUANIO_TELEGRAM_REACTION_ENABLED=1
export YUANIO_TELEGRAM_REACTION_EMOJI=✅

# shell fallback（仅当 Agent CLI 不可用且文本看起来像 shell 命令时触发）
export YUANIO_TELEGRAM_SHELL_FALLBACK=1
export YUANIO_TELEGRAM_SHELL_FALLBACK_TIMEOUT_MS=20000
```

启动后 CLI 会自动：

- 启动本地 webhook server
- 调用 Telegram `setMyCommands`
- 当配置了 `YUANIO_TELEGRAM_WEBHOOK_URL` 时自动调用 `setWebhook`
- 默认在 `setWebhook` 时丢弃历史 pending（`YUANIO_TELEGRAM_WEBHOOK_DROP_PENDING=0` 可关闭）
- 支持 `/clear`（中止任务并清空队列）、`/loop <prompt>`（循环任务模板）
- 在审批到达时发送 inline keyboard（批准/拒绝）
- 对 Telegram 发起的任务实时编辑消息（过程 + 输出）
- 输出区域会把 Markdown 自动转换为 Telegram HTML（行内代码、代码块、列表、链接等）
- 在可识别的交互场景自动附加按钮（Yes/No/Enter/Esc/选项）
- 对接收的 Telegram 消息自动回 ✅ reaction（可关闭）
- 当 Agent CLI 不可用且输入像 shell 命令时，自动回退 shell 执行并回传输出
- 进程退出时自动 `deleteWebhook`（可通过 `YUANIO_TELEGRAM_AUTO_DELETE_WEBHOOK=0` 关闭）

安全建议：

- 必须配置 `YUANIO_TELEGRAM_WEBHOOK_SECRET`
- 仅接受已配对 `telegramChatId` 的消息
- 高风险命令保留在 App 审批流中，Telegram 侧只做触发与确认

关键检查项：

- `Relay(control)`：本地 relay 连通性
- `Relay(public)`：公网入口连通性
- `DNS`：系统解析与公共解析是否一致
- `Proxy`：是否存在会干扰连通性的代理环境变量
- `CF Service`（Windows）：cloudflared 服务状态

## RPC 扩展（目录浏览 / CWD / 上传提示）

新增 RPC 方法：

- `foreground_probe`：返回远端前后台探测快照（状态、会话、cwd、turnState）。
- `list_dirs`：目录浏览，返回 `cwd/parent/roots/entries`。
- `change_cwd`：切换工作目录并刷新心跳/状态。

`upload_commit` 新增返回字段：

- `atPath`：可直接用于 `@path` 引用的路径（正斜杠格式）。
- `promptRef`：`@${atPath}`。
- `suggestedPrompt`：若传了 `promptText`，返回可直接发送的组合 prompt。
- `cleanupScheduledMs`：若启用延迟清理，返回实际调度毫秒数。

可选环境变量（上传后自动清理默认 TTL）：

```bash
# upload_commit 参数里 ephemeral=true 且未显式指定 cleanupAfterMs 时生效
export YUANIO_UPLOAD_SUBMITTED_FILE_TTL_MS=600000
```

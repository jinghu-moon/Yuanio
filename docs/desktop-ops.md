# 桌面端运维（GUI-only + Rust Core）

本文是 Yuanio 桌面端推荐运行方式（内嵌 Rust Relay/Daemon，GUI 驱动）。

## 架构

- 控制链路（桌面端）：`http://localhost:3000`
- 公网链路（手机端）：`https://relay.yourdomain.com`（由 `tunnelHostname` 生成）

## 配对

在桌面端「配对」页完成：

- 控制端地址：`serverUrl`（默认 `http://localhost:3000`）
- 公网地址：在「配置中心」设置 `tunnelHostname`，UI 会自动生成 `https://{tunnelHostname}`

## 一次性配置

1. 选择运行模式：

- `LAN`：仅本机访问
- `Tunnel`：公网访问（推荐）

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

4. 配置桌面端（配置中心）：

- 可编辑：`serverUrl`、`namespace`、`relayPort`、`autoStart`、`connectionProfile`、`tunnelMode`、`tunnelName`、`tunnelHostname`、`language`
- 保存会写入 `~/.yuanio/config.json`

5. 启动服务（Services）：

- 一键启动或分别启动 `Relay/Daemon/Tunnel`
- 修改配置后建议停止服务再启动

## 日常检查

- 「诊断」页：填写 `control/public URL` 后点击「开始诊断」
- 「状态」页：确认 `Relay/Daemon/Tunnel` 运行状态与日志

## 说明

- 桌面端已切换为 GUI-only，CLI/TUI 入口不再作为桌面端运维路径。
- 如需纯服务器/自动化脚本，请使用服务端部署方案。

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

桌面端 GUI-only 版本不提供 CLI 级脚本化控制与 Telegram Webhook 控制面。

# Cloudflare Tunnel 部署指南

通过 Cloudflare Tunnel 将 Yuanio 中继服务器暴露到公网，无需公网 IP。

## 推荐架构（最终）

- 控制链路（桌面端）：`http://localhost:3000`
- 公网链路（手机端）：`https://relay.yourdomain.com`
- 配对命令固定走双地址：`--server` 指本地控制地址，`--public-server` 指公网地址

这样即使桌面端本机 DNS 被污染或受限，也不影响配对和控制。

## 前置要求

- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 已安装
- Cloudflare 账号 + 已托管域名

## 步骤

### 1. 启动中继服务器

```bash
# Docker 方式
docker run -d --name yuanio-relay -p 3000:3000 ghcr.io/anthropics/yuanio/relay-server:latest

# 或源码方式
cargo run --manifest-path crates/relay-server/Cargo.toml
```

### 2. 创建 Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create yuanio
cloudflared tunnel route dns yuanio relay.yourdomain.com
```

### 3. 配置 Tunnel

创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: yuanio
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: relay.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 4. 启动 Tunnel

```bash
cloudflared tunnel run yuanio
```

### 4.1 Windows 服务化（推荐）

以管理员 PowerShell 执行（长期运行，开机自启）：

```powershell
.\scripts/install-cloudflared-service.ps1 -TunnelName "yuanio" -RelayPort 3000
```

脚本会自动执行：

- `ingress validate` 配置校验
- 备份 `~/.cloudflared/config.yml`
- 备份 `~/.cloudflared/*.json` 与 `cert.pem`（若存在）
- 同步配置到 `systemprofile`（服务账户）并重写 `credentials-file`
- 固化服务 `binPath` 为 `tunnel --config <systemprofile-config> run <tunnel-id>`
- 备份当前服务快照（若已安装）

服务安装后可用以下命令查看状态：

```powershell
Get-Service "cloudflared"
sc.exe qc cloudflared
```

`sc qc` 输出中应包含：

```text
BINARY_PATH_NAME   : "<cloudflared.exe>" tunnel --config "C:/Windows/System32/config/systemprofile/.cloudflared/config.yml" run <tunnel-id>
```

本地 Relay/Daemon 建议交给 PM2 常驻：

```bash
bunx pm2 start scripts/pm2/ecosystem.config.cjs
bunx pm2 save --force
```

如果已全局安装 `pm2`，也可直接使用 `pm2 start/save`。

### 5. 连接 CLI

```bash
bun run packages/cli/src/index.ts --server http://localhost:3000 --public-server https://relay.yourdomain.com --namespace default --pair
```

如果桌面端本机 DNS 受限（无法正确解析公网域名），可以把控制链路和手机公网链路分离：

```bash
# 桌面端通过本地 relay 发起配对；二维码/配对码里仍使用公网地址
bun run packages/cli/src/index.ts --server http://localhost:3000 --public-server https://relay.yourdomain.com --pair
```

### 6. 健康检查与诊断

```bash
bun run packages/cli/src/index.ts doctor --server http://localhost:3000 --public-server https://relay.yourdomain.com
```

`doctor` 会检查：

- 控制链路 `/health`
- 公网链路 `/health`
- 本机 DNS 与公共 DNS 解析是否一致
- 代理环境变量是否干扰
- cloudflared 可执行与 Windows 服务状态
- CLI 与 Relay 协议主版本兼容性（`Protocol`）

## 注意事项

- 原生 WebSocket 连接通过 Cloudflare Tunnel 自动支持
- 建议启用 Cloudflare Access 限制访问（可选）
- 生产环境请设置 `JWT_SECRET` 环境变量

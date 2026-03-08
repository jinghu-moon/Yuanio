# 环境变量配置

## 自动加载顺序

Relay Server 与 Launcher 现在会自动合并以下配置来源：

1. 工作区根目录 `.env`
2. 工作区根目录 `.env.local`
3. 用户目录 `~/.yuanio/runtime.env`
4. 当前进程环境变量

优先级从低到高，后者覆盖前者。

## 必填项

### `JWT_SECRET`
- 用途：Relay 签发与校验 JWT
- 要求：至少 32 个字符
- 示例：`JWT_SECRET=your-secret-key-min-32-chars-change-this`

如果未配置 `JWT_SECRET`，Launcher 在启动 Relay 前会直接报错，Relay 单独启动时也会明确失败。

## 可选项

### 服务端口
- `PORT=3000`
- `DASHBOARD_PORT=3001`

### 数据库
- `YUANIO_DB_PATH=./data/yuanio.db`
- `YUANIO_DB_BUSY_TIMEOUT_MS=3000`
- `YUANIO_DB_FAST_WRITE_MODE=1`

### 日志
- `LOG_LEVEL=info`
- `YUANIO_RELAY_LATENCY_LOG=0`

### 第三方集成
- `FCM_SERVICE_ACCOUNT=`
- `TELEGRAM_BOT_TOKEN=`

## 推荐做法

开发环境推荐在仓库根目录创建 `.env`：

```dotenv
JWT_SECRET=your-secret-key-min-32-chars-change-this
PORT=3000
```

如果你希望跨多个工作区复用同一套本机配置，可以把密钥放到：

```text
~/.yuanio/runtime.env
```

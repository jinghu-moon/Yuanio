# 安全设计

## 1. 威胁模型

### 信任边界

```
┌─ 可信区域 ─────────────────────────────────────────────────┐
│  Android App (用户设备)        Yuanio CLI+Daemon (用户电脑) │
│  持有私钥，可解密内容             持有私钥，可解密内容         │
└────────────────────────────────────────────────────────────┘
                          ↕ E2E 加密
┌─ 不可信区域 ───────────────────┐
│  Relay Server (云端)           │
│  只能看到密文，无法解密          │
└────────────────────────────────┘
```

### 主要威胁

| 威胁 | 风险等级 | 缓解措施 |
|------|---------|---------|
| 中继服务器被入侵 | 高 | E2E 加密，服务器无法解密任何内容 |
| 中间人攻击 | 高 | TLS 1.3 + E2E 加密双重保护 |
| 配对码暴力破解 | 中 | 配对码 5 分钟过期 + 速率限制 |
| 设备丢失 | 中 | App 端本地认证（生物识别/PIN） |
| 重放攻击 | 中 | 消息 nonce + 时间戳校验 |

## 2. 端到端加密方案

> 加密库：Web Crypto API（ECDH P-256 + HKDF-SHA256 + AES-256-GCM）
> Android 端：EC(P-256) + HKDF + AES-GCM，密钥材料通过 EncryptedSharedPreferences（MasterKey 基于 Android Keystore）保护

### 2.0 竞品加密方案对比（源码验证）

| 维度 | Happy | HAPI | Yuanio |
|------|-------|------|----------|
| E2E 加密 | ✅ 双变体 | ❌ 无 | ✅ AES-GCM |
| 对称加密 | XSalsa20-Poly1305 (Legacy) + AES-256-GCM (DataKey) | — | AES-256-GCM |
| 密钥交换 | libsodium `box()` + 临时密钥对 | — | ECDH P-256 + HKDF |
| 认证 | Ed25519 签名挑战-响应 | CLI_API_TOKEN + JWT | 配对码 + sessionToken |
| 密钥存储 | `~/.happy/access.key` (受限权限) | `~/.hapi/settings.json` (明文 token) | `~/.yuanio/keys.json` (mode 0o600) |
| 服务器可见性 | 零知识（密文存储） | **全部可见**（JSON 明文存储） | 零知识（信封路由） |

**关键发现：**
- HAPI 完全无 E2E 加密，Hub SQLite 中存储明文 JSON，依赖 TLS + 直连安全
- Happy 的 DataKey 模式更先进：每会话随机 AES 密钥 + 公钥加密密钥交换，支持前向保密
- Yuanio 采用 Web Crypto 标准算法栈，便于跨端一致实现

### 2.1 密钥体系

```
设备密钥对 (长期)
└── ECDH P-256 密钥对      ── 共享密钥协商

会话密钥 (临时)
└── AES-256-GCM 会话密钥    ── 由 ECDH 共享秘密经 HKDF-SHA256 派生
```

### 2.2 配对与密钥交换

```
1. Agent 生成 ECDH P-256 密钥对（SPKI/PKCS8 Base64）
2. Agent 调用 /api/v1/pair/create，上传公钥
3. 服务器返回配对码（格式：XXX-XXX，7字符）
4. 用户在 App 输入配对码
5. App 生成 ECDH P-256 密钥对
6. App 调用 /api/v1/pair/join，上传公钥，获取 Agent 公钥
7. 双方各自用 ECDH 计算共享秘密，并用 HKDF-SHA256 派生会话密钥
8. 后续所有消息使用 AES-256-GCM 加密（含 AAD 绑定信封元数据）
```

### 2.3 消息加密格式

```
┌──────────┬────────────────────────────┐
│ IV       │ 密文 + AuthTag (GCM)       │
│ 12 bytes │ 变长                        │
└──────────┴────────────────────────────┘
```

- 每条消息使用随机 IV，防止重放
- 使用 AAD 绑定信封元数据，防止路由字段被篡改

## 3. 安全实践

### 3.1 中继服务器

- 持久化密文消息（服务器无法解密）
- 仅记录连接元数据（设备ID、连接时间）用于调试
- 配对码速率限制：同一 IP 每分钟最多 5 次尝试
- 会话 token 使用 JWT，有效期 24 小时，支持主动吊销

### 3.2 Android App

- 会话密钥存储在 EncryptedSharedPreferences（MasterKey 基于 Android Keystore）
- App 启动需要生物识别或 PIN 验证
- 会话数据不写入外部存储
- 截屏保护（FLAG_SECURE）可选开启

### 3.3 桌面端 CLI/Daemon

- 私钥存储在用户目录下，权限 600
- 配置文件不包含任何密钥明文
- CLI/Daemon 仅通过中继服务器通信，不开放公网监听端口

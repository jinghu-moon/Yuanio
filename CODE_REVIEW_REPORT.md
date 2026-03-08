# Yuanio 项目代码评审报告

**评审时间**: 2026-03-07
**评审依据**: VERIFICATION_REPORT.md
**评审范围**: 安全性、代码质量、架构设计

---

## 🔴 严重问题 (Critical)

### 1. Android 密钥库凭证泄露风险

**位置**: `android-app/keystore/keystore.properties`

**问题描述**:
- 密钥库密码以明文形式存储在配置文件中
- 该文件**未被 `.gitignore` 忽略**，存在提交到版本控制的风险
- 当前密码: `TbgQqtMdpEkzeHqZaPLzeuXVy6FJFtPK`

**风险评估**:
- **严重级别**: 🔴 Critical
- **影响范围**: 应用签名安全、发布渠道信任
- **攻击场景**:
  - 若提交到公开仓库，攻击者可获取密钥库密码
  - 可伪造签名的恶意 APK，冒充官方应用
  - 破坏 F-Droid / Google Play 发布信任链

**修复建议**:
```bash
# 1. 立即将该文件加入 .gitignore
echo "android-app/keystore/keystore.properties" >> .gitignore

# 2. 检查 git 历史是否已泄露
git log --all --full-history -- "android-app/keystore/keystore.properties"

# 3. 如已提交，必须执行以下操作：
#    a. 使用 git filter-repo 清除历史记录
#    b. 重新生成密钥库（旧密钥已不可信）
#    c. 强制推送清理后的仓库

# 4. 使用环境变量或 Gradle 属性注入密码
# 在 build.gradle.kts 中：
signingConfigs {
    create("release") {
        storeFile = file(System.getenv("YUANIO_KEYSTORE_PATH") ?: "keystore/yuanio-release.jks")
        storePassword = System.getenv("YUANIO_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("YUANIO_KEY_ALIAS")
        keyPassword = System.getenv("YUANIO_KEY_PASSWORD")
    }
}
```

**验证方法**:
```bash
# 确认文件已被忽略
git check-ignore android-app/keystore/keystore.properties
# 应输出: android-app/keystore/keystore.properties

# 确认未在 git 历史中
git log --all --oneline -- "android-app/keystore/keystore.properties"
# 应无输出
```

---

## 🟡 高风险问题 (High)

### 2. 生产环境日志泄露风险

**位置**: `packages/relay-server/src/`, `packages/cli/src/`

**问题描述**:
- 生产代码中存在 **189 处** `console.log` / `console.error` 调用
- 可能泄露敏感信息（token、设备 ID、消息内容）

**风险评估**:
- **严重级别**: 🟡 High
- **影响范围**: 隐私泄露、调试信息暴露
- **攻击场景**:
  - 日志文件被攻击者获取
  - 敏感数据通过日志系统传播到第三方服务

**修复建议**:
```typescript
// 1. 引入结构化日志库（如 pino）
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['token', 'password', 'deviceId', 'sessionId'], // 自动脱敏
});

// 2. 替换所有 console.log
// 不良实践：
console.log('User token:', token);

// 最佳实践：
logger.info({ event: 'auth_success' }, 'User authenticated');
```

**验证方法**:
```bash
# 审计所有日志调用
rg "console\.(log|error|warn)" packages/ --type ts | grep -v test
```

### 3. JWT 密钥管理不足

**位置**: `packages/relay-server/src/jwt.ts:5`

**问题描述**:
- 开发环境使用硬编码的默认密钥: `yuanio-dev-secret-change-in-production`
- 虽有生产环境检查，但开发环境 token 可被预测

**风险评估**:
- **严重级别**: 🟡 High
- **影响范围**: 开发/测试环境的认证安全
- **攻击场景**:
  - 开发环境 token 可被伪造
  - 若误将 `NODE_ENV` 配置为非 production，生产环境将使用弱密钥

**修复建议**:
```typescript
// 移除硬编码默认密钥
function resolveSecret(): Uint8Array {
  const configured = process.env.JWT_SECRET?.trim();

  if (!configured) {
    throw new Error("[jwt] 必须配置 JWT_SECRET 环境变量");
  }

  if (configured.length < MIN_SECRET_LENGTH) {
    throw new Error(`[jwt] JWT_SECRET 过短，至少需要 ${MIN_SECRET_LENGTH} 字符`);
  }

  return new TextEncoder().encode(configured);
}
```

---

## 🟠 中风险问题 (Medium)

### 4. 依赖版本管理不规范

**位置**: `packages/*/package.json`

**问题描述**:
- 使用 `^` 范围版本号（如 `^4`, `^1`）
- 可能导致不同环境安装不同版本

**修复建议**:
```json
{
  "dependencies": {
    "socket.io": "4.7.5",  // 锁定精确版本
    "hono": "4.6.3"
  }
}
```

### 5. 测试覆盖率不足

**位置**: 全项目

**问题描述**:
- 仅 23 个测试文件
- 关键路径（加密、认证）测试不充分

**修复建议**:
- 添加覆盖率工具: `bun add -d @vitest/coverage-v8`
- 优先补充关键路径测试

### 6. 错误处理不一致

**位置**: 多处

**问题描述**:
- 部分函数返回 `null` 表示错误
- 部分函数抛出异常

**修复建议**:
```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

---

## 🟢 低风险问题 (Low)

### 7. 技术债务标记
- 存在 7 处 `TODO/FIXME/HACK` 标记

### 8. 国际化未使用的 key
- 2 个未使用的翻译 key

---

## ✅ 优秀实践

1. **端到端加密设计** - Web Crypto API 标准算法，零知识架构
2. **技能系统架构** - 模块化设计，测试覆盖充分
3. **Hooks 系统** - 安全检查完善
4. **类型安全** - 全项目 TypeScript，零类型错误

---

## 📋 修复优先级

| 优先级 | 问题 | 预计工作量 | 风险降低 |
|--------|------|-----------|---------|
| P0 | Android 密钥库凭证泄露 | 2h | Critical → Safe |
| P1 | JWT 密钥管理 | 1h | High → Medium |
| P1 | 生产日志泄露 | 4h | High → Low |
| P2 | 依赖版本锁定 | 1h | Medium → Low |
| P2 | 测试覆盖率 | 8h | Medium → Low |
| P3 | 错误处理统一 | 4h | Medium → Low |

---

## 🎯 总体评估

**代码质量**: ⭐⭐⭐⭐☆ (4/5)
**安全性**: ⭐⭐⭐☆☆ (3/5) - 存在关键安全问题
**可维护性**: ⭐⭐⭐⭐☆ (4/5)
**测试完整性**: ⭐⭐⭐☆☆ (3/5)

**结论**: 项目整体架构优秀，但存在 **1 个严重安全问题**（Android 密钥泄露）和 **2 个高风险问题**（日志泄露、JWT 密钥管理），必须在生产发布前修复。

**建议行动**:
1. 立即修复 P0 问题（Android 密钥库）
2. 在 1 周内修复 P1 问题
3. 在 2 周内完成 P2 问题

---

**评审人**: Claude (Kiro AI)
**评审日期**: 2026-03-07
**下次评审**: 修复 P0/P1 问题后


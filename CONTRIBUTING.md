# 贡献指南

感谢你对 Yuanio 的关注！欢迎提交 Issue 和 Pull Request。

## 开发环境搭建

### 前置要求

- [Bun](https://bun.sh/) >= 1.0
- [Rust](https://www.rust-lang.org/tools/install)（包含 cargo）
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 已安装并登录
- Node.js >= 18（可选，用于兼容性测试）

### 安装

```bash
git clone https://github.com/anthropics/yuanio.git
cd yuanio
bun install
```

### 项目结构

```
packages/
├── shared/          # @yuanio/shared — 加密、类型、信封
├── relay-server/    # @yuanio/relay-server — 中继服务器
└── cli/             # @yuanio/cli — CLI 客户端
```

### 启动开发

```bash
# 启动中继服务器
cargo run --manifest-path crates/relay-server/Cargo.toml

# 另一个终端，启动 CLI（配对模式）
cd packages/cli && bun run src/index.ts --server http://localhost:3000 --pair

# 另一个终端，运行 E2E 测试
cd packages/cli && bun run src/test-e2e.ts --pairing-code <配对码> --prompt "hello"
```

## 提交规范

使用语义化提交信息：

- `feat:` 新功能
- `fix:` 修复 Bug
- `refactor:` 重构（不改变行为）
- `docs:` 文档变更
- `test:` 测试相关
- `chore:` 构建/工具链变更

## Pull Request 流程

1. Fork 仓库并创建特性分支
2. 确保所有测试通过
3. 提交 PR 并描述变更内容
4. 等待 Review

## 安全问题

如发现安全漏洞，请勿公开提交 Issue，请通过邮件联系维护者。

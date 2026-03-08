# Skills Panel V2 分阶段任务清单

更新时间：2026-03-05  
来源：`docs/skills-panel-management.md`（V2）  
执行原则：从底层到消费层；每阶段“实现 + 测试闸门”通过后才进入下一阶段。

## 0. 约束与依据

- 不猜测协议与 API，先对齐现有代码结构与官方文档。
- 不做未在 V2 范围内的扩展（YAGNI）。
- 每个阶段都提供可复现实证（命令 + 结果）。

参考依据（官方）：

- Node.js `fs/promises`（目录遍历、原子移动、临时目录）  
  https://nodejs.org/api/fs.html
- Node.js `path`（路径规范化、跨平台处理）  
  https://nodejs.org/api/path.html
- Git `clone` / `archive`（下载源处理）  
  https://git-scm.com/docs/git-clone
- Telegram Bot API（命令与回调交互）  
  https://core.telegram.org/bots/api
- Jetpack Compose Navigation（Android 页面接入）  
  https://developer.android.com/jetpack/compose/navigation

## M1 底层（Domain/Engine/RPC）

目标：完成 skills 安装会话底座与 `prepare/commit/cancel/status` RPC 闭环。

任务：

- [ ] 新增安装域模型：`SkillCandidate`、`SkillInstallSession`、`SkillInstallResult`
- [ ] 新增安装引擎（本地 path + git/url 扩展位）
- [ ] 支持扫描单源多技能（识别多个 `SKILL.md`）
- [ ] 候选字段强制包含：`name/description/path/scope/valid/warnings`
- [ ] `description` 回退策略：frontmatter -> 首段 -> `(no description)`
- [ ] 原子安装：`tmp -> rename`，单项失败回滚
- [ ] 冲突策略：`skip/overwrite/rename`
- [ ] 新增 RPC：
  - [ ] `skill_install_prepare`
  - [ ] `skill_install_commit`
  - [ ] `skill_install_cancel`
  - [ ] `skill_install_status`
- [ ] 扩展 `RpcContext` / `RpcDeps` 注入

测试闸门（全部通过）：

- [ ] `bun test packages/cli/src/remote/__tests__/rpc.test.ts`
- [ ] `bun run typecheck`

---

## M2 CLI + Telegram 消费层

目标：在命令与 Telegram 端完成 `prepare -> 选择 -> commit` 交互。

任务：

- [ ] CLI 增加 `/skills install <source>` 流程
- [ ] CLI 支持候选多选（编号/名称/all）
- [ ] CLI 显示候选最小字段：`name + description + path + valid`
- [ ] Telegram 增加 `/skills install <source>` 命令
- [ ] Telegram 支持“会话选择 + 提交安装”交互（文本或回调按钮）
- [ ] Telegram `/skills` 展示增强（状态/scope/最近安装结果）

测试闸门（全部通过）：

- [ ] `bun test packages/cli/src/__tests__/telegram-webhook.test.ts`
- [ ] `bun test packages/cli/src/remote/__tests__/rpc.test.ts`
- [ ] 手工 smoke：Telegram 发起 install 与 commit 一次成功

---

## M3 Web + Android + Desktop TUI

目标：完成 V2 约定的管理面板（Web/Android）与 TUI（桌面）。

任务：

- [x] Web Dashboard 增加 Skills 面板：
  - [x] 列表（搜索/筛选/启停）
  - [x] 详情（元数据/校验/依赖）
  - [x] 安装（prepare/选择/commit）
  - [x] 调试（dry-run/日志）
- [x] Android 新增 Skills Screen（Compose）：
  - [x] 列表
  - [x] 安装页（prepare/候选复选/commit）
  - [x] 日志页（最近安装与运行记录）
- [x] Desktop TUI（Ink）新增 Skills Tab：
  - [x] 列表 + 筛选 + 启停
  - [x] 安装会话
  - [x] dry-run + 日志查看

测试闸门（全部通过）：

- [x] Web：启动后功能回归 smoke（skills 相关）
- [x] Android：`./gradlew :app:testDebugUnitTest`
- [x] TUI：`bun run packages/cli/src/launcher/index.tsx` 手工验证

验证记录（2026-03-05）：

- [x] `bun run typecheck`
- [x] `./gradlew.bat :app:testDebugUnitTest`
- [x] `bun run packages/web-dashboard/src/server.ts`（通过 `app.fetch` smoke 验证 `/api/daemon/skills/list`、`/api/daemon/skills/logs`）
- [x] `bun run packages/cli/src/launcher/index.tsx`

---

## M4 稳定性与治理

目标：补齐一致性、错误码、审计与回归。

任务：

- [x] 统一错误码与可读错误文案
- [x] 安装与运行审计日志（installId/runId）
- [x] 并发安装互斥与过期会话清理
- [x] 回归重复消息/重复编辑保护（Telegram）
- [x] 文档同步：更新 `docs/skills-panel-management.md` 中实施状态

测试闸门（全部通过）：

- [x] 全量 typecheck
- [x] 关键路径测试（RPC/Telegram/Android）
- [x] 手工端到端：source -> prepare -> select -> commit -> invoke

验证记录（2026-03-05）：

- [x] `bun run typecheck`
- [x] `bun test packages/cli/src/remote/__tests__/rpc.test.ts packages/cli/src/__tests__/telegram-webhook.test.ts`
- [x] `./gradlew.bat :app:testDebugUnitTest`
- [x] Web smoke：`/api/daemon/skills/list`、`/api/daemon/skills/logs`（Dashboard `app.fetch`）
- [x] 手工 E2E 脚本：`prepare_candidates=1`, `commit_installed=1`, `invoke_preview=ok`

---

## 当前执行状态

- [x] 分阶段任务清单已落盘
- [x] M1 已完成（已通过 `rpc.test.ts` + `typecheck`）
- [x] M2 已完成（已通过 `telegram-webhook.test.ts` + `rpc.test.ts` + `typecheck`）
- [x] M3 已完成（Web/Android/TUI 闸门通过）
- [x] M4 已完成（稳定性与治理项完成，闸门通过）

# Skills 面板管理方案（V2）

更新时间：2026-03-05  
版本：V2（替代 v.21）  
状态：Implemented（M1-M4 已完成）

## 实施状态（2026-03-05）

- M1 底层：已完成（`prepare/commit/cancel/status` + 多 Skill 扫描 + 原子安装 + 冲突策略）
- M2 CLI/Telegram：已完成（`/skills install|status|commit|cancel` 全链路）
- M3 Web/Android/TUI：已完成（Skills 面板/页面/Tab 与 daemon `/skills/*` API 对齐）
- M4 稳定性：已完成（统一错误码、审计持久化、并发安装互斥、过期会话清理、Telegram 重复发送保护）

## 1. 目标

- 将现有 `skills` 能力从“可调用”升级为“可管理、可调试、可治理”。
- 覆盖 CLI / Telegram / Android / Web 四端一致能力（其中 GUI 仅 Web + Android）。
- 兼容现有 slash 命令与 RPC，不破坏已上线链路。

## 2. 核心范围（V2）

- Skills 列表管理（搜索、筛选、启停、作用域、最近调用）
- Skill 详情管理（元数据、校验、依赖文件、权限预览）
- Skill 调试（dry-run、参数预览、运行轨迹、失败重放）
- Skills 安装管理（下载/扫描后“选择安装”）
- 运行日志与审计（安装、启停、调用结果）

## 3. 关键升级点（相对 v.21）

### 3.1 下载源多 Skill 选择

单个下载源（git clone / zip / 本地目录）可能包含多个 skills，改为两阶段安装：

1. `prepare`：下载并扫描候选，不安装  
2. `commit`：用户选择后安装所选

### 3.2 候选项必须包含 description

候选列表展示字段最小集：

- `name`
- `description`
- `path`（源内相对路径）
- `scope`（project/user）
- `valid`（校验通过与否）
- `warnings`（可选）

`description` 解析规则：

1. 优先 frontmatter `description`
2. 无 frontmatter 时取正文首段（截断 120 字）
3. 为空则填 `(no description)` 并标记 warning

## 4. 分层设计（从底层到消费层）

### 4.1 Domain

- `SkillRecord`
- `SkillCandidate`
- `SkillInstallSession`
- `SkillRunRecord`

### 4.2 Storage

- 本地 skills 索引缓存
- 安装临时目录与会话目录
- 运行日志与审计日志

### 4.3 Engine

- SourceResolver（git/url/path）
- Fetcher（下载/解包）
- Scanner（发现 `SKILL.md`）
- Validator（frontmatter/结构/引用校验）
- Installer（原子安装：`tmp -> rename`，单 skill 失败单独回滚）

### 4.4 RPC

新增：

- `skill_install_prepare({ source, scope })`
- `skill_install_commit({ installId, selected, force })`
- `skill_install_cancel({ installId })`
- `skill_install_status({ installId })`

保留并扩展：

- `list_skills`
- `invoke_skill`
- `skill_validate`
- `skill_runs`

### 4.5 消费层

- CLI：`/skills install/show/test/logs`
- Telegram：`/skills install <source>` 后返回候选列表，支持编号或名称选择
- Android/Web（GUI）：新增 Skills 面板（列表页/详情页/安装页/调试页）
- Desktop（TUI）：通过 CLI/Ink 提供列表、筛选、启停、安装选择、dry-run、日志查看

## 5. 交互流程

### 5.1 安装流程

1. 用户输入安装源（repo/url/path）
2. 调用 `skill_install_prepare`
3. 返回候选列表（必须显示 `name + description`）
4. 用户多选（编号或名称，支持 `all`）
5. 调用 `skill_install_commit`
6. 返回 `installed[] / failed[]`

### 5.2 调试流程

1. 选择 skill
2. 输入 args + context（可选）
3. dry-run 执行
4. 展示：参数解析、工具调用轨迹、输出摘要、错误详情
5. 支持一键重放

## 6. UI 功能方案

### 6.1 列表页

- 搜索：name/description/path
- 筛选：scope/enabled/health
- 列字段：name、description、scope、status、最近调用、成功率

### 6.2 详情页

- 元数据编辑（description、invocation、allowed-tools）
- 依赖文件树
- 校验报告（errors/warnings）

### 6.3 安装页

- 来源输入
- 候选多选（name + description 必显）
- 冲突策略（skip/overwrite/rename）
- 安装结果与回滚提示

### 6.4 调试页

- args 输入框
- dry-run 按钮
- 轨迹时间线（tool_call / tool_result）

## 7. GUI 布局设计（V2 新增）

### 7.1 Web 三栏布局

```text
┌ TopBar: 搜索 | Scope筛选 | 状态筛选 | 新建/导入Skill ┐
├ 左侧(24%)：来源与分组                                       ┤
│  - Project / User / Remote Sources                        │
│  - 健康状态统计(总数/启用/告警)                            │
├ 中间(38%)：Skills 列表                                     ┤
│  - 每行: 名称 + description(2行) + scope + 状态 + 成功率    │
│  - 支持多选、排序、快速启停                                 │
├ 右侧(38%)：Skill 详情                                      ┤
│  Tab: 概览 | 配置 | 依赖 | 调试 | 日志                      │
│  - 概览: name/description/path/版本/最近调用                │
│  - 配置: auto-invoke/user-invocable/allowed-tools          │
│  - 调试: args输入 + dry-run + 轨迹时间线                    │
└ 底部抽屉：安装会话(prepare -> 选择 -> commit)               ┘
```

### 7.2 Android 移动端布局

```text
TopAppBar: Skills
Tabs: 列表 | 安装 | 日志

列表页:
- 卡片式列表
- 卡片必须显示: name + description + scope + enabled

详情页(进入卡片):
- 分段: 概览/配置/调试
- 调试区固定底部按钮: Dry Run / 保存

安装页:
- 输入source
- Prepare后展示候选列表(复选框)
- 每项: name + description + path + valid
- 底部固定按钮: 安装所选
```

### 7.3 Desktop TUI 交互布局（非 GUI）

```text
┌ Skills (TUI) ───────────────────────────────────────────────┐
│ [/]搜索  [s]scope  [e]启停  [i]安装  [t]dry-run  [l]日志    │
├ 左列：skills 列表（name + description）                     ┤
├ 右列：详情（metadata / allowed-tools / 最近运行）           ┤
├ 底栏：安装会话/选择项（prepare -> 选择 -> commit）          ┤
└ 状态行：当前结果、错误提示、快捷键提示                      ┘
```

### 7.4 安装候选弹窗/面板

- 标题：`发现 N 个 skills`
- 列表项固定字段：`name`、`description`、`path`、`valid`
- 交互：`全选`、`仅有效项`、`按名称搜索`
- 冲突策略：`skip | overwrite | rename`
- 主按钮：`安装所选 (k/N)`

### 7.5 状态反馈设计

- `prepare`：进度条 + 扫描日志
- `commit`：逐项状态（成功/失败）
- 失败项展示可操作原因（frontmatter 缺失、路径冲突、校验失败）
- 支持 `复制错误`、`重试失败项`

## 8. 安全与治理

- 默认允许源白名单（github + 配置域名）
- 安装阶段不执行脚本
- 文件大小/数量限制
- 路径穿越防护（仅允许 skill 根目录内相对引用）
- 审计日志：来源、hash、安装人、时间、结果

## 9. 实施里程碑

### M1（底层）

- `prepare/commit/cancel/status` RPC
- SourceResolver + Fetcher + Scanner + Validator

### M2（CLI/Telegram）

- `/skills install` 交互闭环
- 候选项展示 `name + description + path`

### M3（Android/Web 面板）

- Android/Web GUI：Skills 列表/详情/安装/调试页
- Desktop TUI：Skills 列表/筛选/启停/安装选择/dry-run/日志

### M4（稳定性）

- 回归测试、错误码统一、性能与并发安装处理

## 10. 验收标准

- 同一来源多 skill 可被选择性安装
- 候选列表始终包含 `description`
- 安装失败不污染已存在 skills
- CLI/Telegram/Android/Web 四端结果一致
- 日志可追踪（installId/runId）

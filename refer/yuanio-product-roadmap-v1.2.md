# Yuanio 产品路线图与功能清单 v1.2

> Version: `1.2`
> Updated: `2026-03-09`
> Source: `direct + README.md + refer/yuanio-mobile-comprehensive-blueprint.md + refer/yuanio-mobile-decision-matrix.md`
> Status: `draft / 可直接转计划`

---

## 0. 一句话定位

Yuanio 不是把 IDE 搬到手机上，也不是普通 AI 聊天壳。

Yuanio 的核心定位是：**跨环境的远程 vibe coding 控制台**。
它让开发者在离开桌面、切换网络、切换设备、甚至只剩一台手机时，仍然可以持续接管本地 AI coding workflow，而不是中断它。

---

## 1. 问题定义

当前开发者在使用本地 AI coding agent 时，普遍会遇到 4 个连续性问题：

- 人离开桌面以后，长任务不可见，状态不透明。
- 遇到审批、diff、失败重试时，必须回到电脑前。
- 同一条工作流被聊天、终端、文件、结果分散承载，移动端缺少统一接管面。
- 本地环境很强，但控制入口被物理环境绑定，远程时体验急剧退化。

Yuanio 要解决的不是“在手机上写更多代码”，而是“在任何环境下不中断既有编码流”。

---

## 2. 产品原则

- **控制优先，不做替代**：手机端优先承担观察、决策、批准、续跑、回退，而不是完整替代桌面 IDE。
- **会话优先，不做零散工具箱**：所有页面都围绕同一条 session / task / approval / result 主线组织。
- **协议优先，不做 Android 私有真相**：产品能力必须建立在 `packages/shared/` 契约之上。
- **渐进收敛，不做大重构**：优先复用现有 `ChatScreen`、`SessionListScreen`、`TerminalScreen`、`FileManagerScreen`、`SettingsScreen`。
- **结果闭环，不做只发消息**：每次输入都应能回到任务、审批、diff、结果、会话状态中的某个可追踪节点。

---

## 3. Component Map

| Component | Responsibility | Inputs / Outputs | Constraints |
|---|---|---|---|
| 首页 | 汇总环境、会话、审批、任务、结果入口 | 输入：`heartbeat`、`interaction_state`、`task_queue_status`；输出：快速接管动作 | 当前仓库无独立首页，需以现有页面能力拼装 |
| 环境页 | 管理设备、Relay、本地直连、配对、健康状态 | 输入：配对信息、连接偏好、设备状态；输出：连接切换、重连、重配对 | 复用 `PairingScreen` + `SettingsScreen` + `LocalConnectionPrefs` |
| 会话页 | 选择、恢复、创建、进入会话；承载主聊天流 | 输入：`session_list`、聊天流、状态流；输出：继续、停止、切换、创建新会话 | 复用 `SessionListScreen` + `ChatScreen` |
| 任务页 | 承载队列、计划任务、待办、执行状态 | 输入：`task_queue*`、`todo_update`、`schedule_*`；输出：排队、取消、优先级调整、计划执行 | 当前协议已具备，Android 侧还未升格为一级页面 |
| 审批页 | 聚合审批请求、风险分级、diff 预览、批量处理 | 输入：`approval_req`、`file_diff`、`interaction_state`；输出：approve / reject / rollback | 当前主要嵌在聊天卡片内，缺少收件箱视图 |
| 结果页 | 呈现任务摘要、变更结果、产物与历史记录 | 输入：`task_summary`、`usage_report`、文件/Git 状态；输出：回看、导出、复跑、跳转文件 | 复用 `FileManagerScreen`、`GitScreen`、`ArtifactStore` |
| 终端工作台 | 作为会话页的深度操作面，处理 PTY、多标签、快速命令 | 输入：`pty_*`；输出：输入、切换 tab、复制、重连 | 已有成熟基础，定位为工作台而非首页 |
| 设置与安全 | 管理保险库、通知、语言、偏好与 IM 集成 | 输入：本地 prefs、凭证状态；输出：安全配置、体验配置 | 已有 `YuanioApp` 初始化与 `SettingsScreen` |

---

## 4. Tech Stack Decisions

| Area | Chosen | Alternatives Considered | Reason |
|---|---|---|---|
| 产品主形态 | 远程控制台 | 手机 IDE / 纯聊天应用 | 更符合现有代码与用户真实使用场景 |
| 数据真相 | `packages/shared/` 协议 + CLI dispatch | Android 自定义事件体系 | 已有 shared contract，重复造真相会增加漂移风险 |
| Android 收敛方式 | 复用现有页面并逐步升格 | 一次性重写导航和状态层 | 当前已完成大半能力，重写性价比低 |
| 会话共享 | `SessionGateway` 应用级共享 | `GlobalSessionManager` / Hilt 注入 | 当前方案已落地且有守卫，不应回退 |
| 结果呈现 | 聊天流 + 任务摘要 + 文件/Git 结果中心 | 仅聊天时间线 | 远程控制的核心价值在“可操作结果”，不是多消息 |
| 审批策略 | 默认关闭 Auto-Reject，风险分级 | 激进自动批准/拒绝 | 安全边界更稳，适合移动端决策 |

---

## 5. Core Data Model

围绕以下 6 个对象组织产品：

- `Environment`
  - 代表一台可被接管的开发环境。
  - 典型字段：`deviceId`、连接方式、Relay 状态、本地直连状态、最后在线时间。
- `Session`
  - 代表一次 agent 工作上下文。
  - 典型字段：`sessionId`、agent 类型、cwd、运行状态、待审批数、运行任务数。
- `Task`
  - 代表一次 prompt 驱动或计划任务驱动的执行单元。
  - 典型字段：`taskId`、prompt、priority、status、duration、usage。
- `Approval`
  - 代表一次需要用户决策的操作请求。
  - 典型字段：`approvalId`、tool、riskLevel、affectedFiles、diffHighlights。
- `Result`
  - 代表任务输出的结果聚合视图。
  - 典型字段：任务摘要、文件 diff、终端摘要、usage、产物链接。
- `Artifact`
  - 代表可回看、可导出、可分享的落地产物。
  - 典型字段：文件、截图、日志、摘要、分享目标。

---

## 6. Integration Points

- 协议真相：`packages/shared/src/types.ts`
- 协议 / schema：`packages/shared/src/schemas.ts`
- CLI 事件分发真相：`packages/cli/src/remote/dispatch.ts`
- Android 主消费入口：`android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- 会话共享：`android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt`
- Android 导航：`android-app/app/src/main/java/com/yuanio/app/ui/navigation/NavGraph.kt`
- 连接与配对：`android-app/app/src/main/java/com/yuanio/app/ui/screen/PairingScreen.kt`
- 会话列表：`android-app/app/src/main/java/com/yuanio/app/ui/screen/SessionListScreen.kt`
- 终端：`android-app/app/src/main/java/com/yuanio/app/ui/screen/TerminalScreen.kt`
- 文件 / Git：`android-app/app/src/main/java/com/yuanio/app/ui/screen/FileManagerScreen.kt`、`android-app/app/src/main/java/com/yuanio/app/ui/screen/GitScreen.kt`
- 偏好与安全：`android-app/app/src/main/java/com/yuanio/app/ui/screen/SettingsScreen.kt`

---

## 7. 页面功能清单

### 7.1 首页

**页面目标**

- 在 5 秒内回答“现在哪台环境在线、哪个会话需要我处理、最紧急的审批/结果是什么”。

**当前基础**

- 当前没有独立首页。
- 可由 `SessionListScreen`、`ChatScreen`、通知与状态流组合实现第一版。

**核心模块**

- 今日环境概览卡
- 当前活跃会话卡
- 待审批收件箱预览
- 运行中 / 排队中任务摘要
- 最新结果入口

**关键交互**

- 一键继续最近会话
- 一键跳转待审批最高风险项
- 一键打开最近失败任务或最近结果

**必须做**

- 环境在线 / 离线状态总览
- 最近会话与运行状态摘要
- 待审批数量与最高风险提示
- 运行中任务数量与最近结果入口

**应该做**

- 最近 24 小时结果时间线
- 最近错误 / 中断恢复建议
- 常用动作快捷入口

**可以做**

- 小组件式首页卡片布局
- 基于角色的首页视图模板

**架构映射**

- 汇总 `heartbeat`、`interaction_state`、`task_queue_status`、`task_summary`
- Android 侧可先以聚合 ViewModel 构建，不急于拆新数据层

### 7.2 环境页

**页面目标**

- 管理“我能控制哪些开发环境、当前通过什么链路连接、是否健康”。

**当前基础**

- `PairingScreen.kt`
- `SettingsScreen.kt`
- `LocalConnectionPrefs` / Relay 配置

**核心模块**

- 已配对环境列表
- 连接模式切换（Relay / 本地直连）
- 环境健康检查
- 重新配对 / 断开 / 替换设备

**关键交互**

- 一键切换主环境
- 一键重连
- 一键复制配对码 / 重新扫码

**必须做**

- 已配对环境清单
- 当前连接通道与连通性
- 重新配对与解绑
- 当前主环境标记

**应该做**

- 环境标签与备注
- 环境能力标识（是否支持终端 / 审批 / 文件 / 结果）
- 多环境最近在线时间

**可以做**

- 多环境分组
- 按网络策略自动选路

**架构映射**

- 继续复用配对、Relay、Local Relay 现有实现
- 不引入新的环境抽象层，先由现有 prefs + session metadata 聚合

### 7.3 会话页

**页面目标**

- 成为 Yuanio 的主工作入口：选会话、恢复会话、继续对话、观察 agent 状态。

**当前基础**

- `SessionListScreen.kt`
- `ChatScreen.kt`
- `ChatViewModel.kt`

**核心模块**

- 会话列表
- 会话状态条
- 聊天流 / thinking / tool call / diff / approval 卡片
- 快速继续 / 停止 / 重试

**关键交互**

- 继续最近 session
- 新建 session
- 在会话内切到终端、文件、审批、结果

**必须做**

- 恢复已有 session
- 新建 session
- 发送 prompt / continue / stop
- 展示 thinking、tool call、approval、diff、status

**应该做**

- 会话筛选与搜索
- 失败会话恢复建议
- 会话级 quick action 区

**可以做**

- Pin 重要 session
- 会话模板与常用 prompt preset

**架构映射**

- 继续以 `ChatViewModel` 为 Android 汇聚入口
- 仍以 shared protocol 为唯一契约源

### 7.4 任务页

**页面目标**

- 把“聊天里的一次输入”提升为可排队、可追踪、可复跑的任务对象。

**当前基础**

- 协议已有 `TASK_QUEUE`、`TASK_QUEUE_STATUS`、`TASK_SUMMARY`、`TODO_UPDATE`、`SCHEDULE_*`
- Android 尚未形成一级任务页

**核心模块**

- 任务队列
- 任务详情
- 待办 / 拆解清单
- 计划任务
- 失败重试与复跑入口

**关键交互**

- 入队 prompt
- 调整优先级
- 查看执行摘要
- 手动复跑 / 定时执行

**必须做**

- 队列列表
- 运行中 / 等待中 / 完成 / 失败状态
- 任务摘要回看
- 手动重试

**应该做**

- TODO 与任务关联
- 定时任务入口
- 任务过滤与搜索

**可以做**

- 任务批处理
- 任务依赖关系

**架构映射**

- 优先吃透 shared task payload，不要在 Android 端自造任务协议
- 第一版可作为 `ChatViewModel` 的辅助页，后续再独立 ViewModel

### 7.5 审批页

**页面目标**

- 从聊天时间线中抽出“需要现在做决定”的内容，形成真正可工作的审批收件箱。

**当前基础**

- 审批卡与风险分级已存在
- `Auto-Reject` 已明确默认关闭
- 当前审批主要嵌入会话流中

**核心模块**

- 审批收件箱
- 风险分级过滤
- diff 预览与关键片段
- 单条决策与批量处理

**关键交互**

- approve / reject
- 打开 diff / 文件上下文
- 跳回原会话或结果页

**必须做**

- 所有待审批项统一入口
- 风险等级展示
- 受影响文件与 diffHighlights 展示
- 批准 / 拒绝闭环

**应该做**

- 按 session / 风险 / 时间过滤
- 批量处理低风险审批
- 审批后跳转结果页

**可以做**

- 审批模板
- 审批 SLA / 超时提醒

**架构映射**

- 以现有 `ApprovalReqPayload`、`FileDiffPayload`、`InteractionStatePayload` 为准
- 不新增 Android 私有审批状态机

### 7.6 结果页

**页面目标**

- 让一次任务的价值沉淀下来，而不是随着聊天流被冲走。

**当前基础**

- `FileManagerScreen.kt`
- `GitScreen.kt`
- `ArtifactStore`
- `TASK_SUMMARY` / `USAGE_REPORT`

**核心模块**

- 任务结果摘要
- 文件变更列表
- Git 结果视图
- 产物与日志入口
- 使用量与耗时统计

**关键交互**

- 查看任务结果
- 跳转文件 / Git diff
- 导出日志 / 结果摘要
- 基于结果重新发起 follow-up

**必须做**

- 任务摘要页
- 文件改动与 Git 结果入口
- usage / duration 基础统计
- 结果回到会话的双向跳转

**应该做**

- 产物中心
- 最近结果历史
- 一键分享结果摘要

**可以做**

- 结果收藏与标签
- 自动生成日报 / 周报

**架构映射**

- 优先复用现有文件与 Git 页面
- 结果页做聚合层，不复制底层文件/Git 逻辑

### 7.7 终端工作台

**页面目标**

- 让用户在必要时能越过聊天层，直接接管终端与调试现场。

**当前基础**

- `TerminalScreen.kt`
- `TerminalViewModel.kt`
- `TerminalPaneContainer.kt`
- `TerminalTabBar.kt`
- `TerminalToolbar.kt`

**核心模块**

- 多 tab 终端
- PTY 状态与连接恢复
- 快捷操作栏
- 会话绑定的终端上下文

**关键交互**

- 新建 / 关闭 tab
- 输入命令
- 复制输出
- 从会话页跳入终端

**必须做**

- 稳定 PTY 输出
- 多 tab 管理
- 终端与会话绑定
- 断线恢复

**应该做**

- 快捷命令与模板
- 常用日志过滤
- 与审批 / 结果联动跳转

**可以做**

- Quake 模式全局呼出
- 终端片段收藏

**架构映射**

- 继续沿用现有终端体系，不另起协议层
- 保持终端是工作台，不抢首页心智

### 7.8 设置与安全

**页面目标**

- 承担本地安全、通知、语言、输入风格、集成开关等系统级配置。

**当前基础**

- `SettingsScreen.kt`
- `YuanioApp.kt`
- `VaultManager` / `KeyStore` / `FeaturePrefs`

**核心模块**

- Vault / 解锁策略
- 通知与审批提醒
- 语言与主题
- 输入 / 终端 / IM 集成偏好

**必须做**

- 安全解锁链路
- 通知开关
- 基础偏好管理

**应该做**

- 按场景切换配置预设
- 审批提醒分级开关

**可以做**

- 工作 / 私人模式配置集

---

## 8. 里程碑路线图

### M1：环境与会话打通

目标：用户可以稳定完成“配对 -> 进入会话 -> 继续会话 -> 查看终端 / 文件 / 状态”。

- 首页第一版
- 环境页第一版
- 会话页收敛
- 终端工作台稳定性补强

### M2：任务与审批闭环

目标：用户可以把任务排起来，把审批收起来，把处理结果接起来。

- 任务页第一版
- 审批页第一版
- 会话页与任务 / 审批联动
- 结果页基础骨架

### M3：结果中心与弱协作

目标：用户可以稳定回看结果、导出结果、围绕结果做后续操作。

- 结果页增强
- 产物中心
- 结果分享与 follow-up
- 首页升级为运营面板

---

## 9. 非目标

- 不做完整手机 IDE
- 不做云端托管型 SaaS 重心迁移
- 不做跨所有平台同时铺开
- 不在当前阶段引入 `Hilt`、`GlobalSessionManager`、`StreamingMarkdown`、`MessageRepository` 分页/LRU
- 不为了“像聊天应用”而牺牲任务、审批、结果闭环

---

## 10. Top Risks

1. **高**：页面概念太多，最后沦为功能拼盘。
   - Mitigation：所有页面都必须落到 `Environment / Session / Task / Approval / Result` 之一，不再新增平行心智模型。
2. **高**：Android 侧为了提速私自扩展协议，导致 shared contract 漂移。
   - Mitigation：继续以 `packages/shared/` 与 CLI dispatch 为唯一协议源。
3. **中**：过早抽新状态层或重构导航，拖慢产品推进。
   - Mitigation：先做聚合页和聚合 ViewModel，尽量站在现有页面骨架上演进。

---

## 11. 当前建议的执行顺序

1. 先做首页信息架构草图与最小数据拼装。
2. 再做环境页与会话页的入口统一。
3. 接着把审批从聊天流中抽成独立收件箱。
4. 然后把任务页和结果页补成闭环。
5. 最后再做首页增强、产物中心和弱协作能力。

---

## 12. 结论

Yuanio 下一阶段最重要的，不是继续增加零散功能，而是把已有能力重新组织成一条清晰的远程控制主线：

`环境 -> 会话 -> 任务 -> 审批 -> 结果`

只要这条主线收敛成功，Yuanio 就会从“已经有很多能力的 Android 远控原型”，升级成“真正适合远程 vibe coding 的产品”。

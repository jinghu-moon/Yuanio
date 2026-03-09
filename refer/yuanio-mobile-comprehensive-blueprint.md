# Yuanio Refactoring Blueprint

> **Version**: 2.1.1 – Protocol-First + Android Phased Convergence
> **Updated**: 2026-03-08
> **Scope**: Cross-stack – `packages/shared/` → `packages/cli/` → `android-app/`
> **Architecture**: Local Agent + Relay + SQLite + Android Remote UI (HAPI 模式)
> **Baseline Audit**: ChatViewModel 4098 行 | ChatItem 内嵌于 ViewModel (L58-111) | ChatInputBar 54+ 参数 (L66) | Markdown 全量重渲染 | Android 手写 JSON 事件解析 (L1880+)

> **v2.1.1 修订焦点**: 收紧 P0 边界；将 `FeaturePrefs` 明确后移到 P3；补充 `AgentEventParser` 的纯函数契约；把“新建文件”和“验证清单”改为分级执行。

---

## 0. Architecture Positioning

> **"本地会话为权威，手机只是远程表面层。"**

### 0.1 根架构 — 不是纯 Android 工程

```
packages/
  ├── shared/          # 协议类型、Zod schemas、加密、共享枚举
  │   ├── src/types.ts         # 60+ MessageType 枚举 + Payload 接口 (L1-569)
  │   ├── src/schemas.ts       # Zod 验证 schema (L1-331)
  │   ├── src/protocol.ts      # PROTOCOL_VERSION="1.0.0" + 兼容检查
  │   └── src/interaction.ts   # 交互状态机
  ├── cli/             # Agent 端: 适配器、事件分发、Relay 客户端
  │   ├── src/adapters/        # Claude/Gemini/Codex 适配器 → NormalizedEvent
  │   ├── src/remote/dispatch.ts   # NormalizedEvent → MessageType 映射 (L1-132)
  │   ├── src/remote/sender.ts     # 信封加密+发送 (L1-99)
  │   └── src/relay-client.ts      # Socket.IO 连接 + ACK (L1-195)
  ├── relay-server/    # 中继路由 + 持久化 + FCM 推送
  │   └── src/index.ts         # 消息路由、持久化策略、交付队列
  └── web-dashboard/   # (参考)

android-app/
  └── app/src/main/java/com/yuanio/app/
      ├── data/        # RelayClient (L1-148), LocalRelayClient (L1-137), EnvelopeHelper
      ├── ui/screen/   # ChatViewModel (L1-4098), ChatScreen, TerminalScreen 等
      ├── ui/chat/     # ChatInputBar (L66-920), ChatMessageList, MessageBubble
      ├── ui/component/# ApprovalCard, ThinkingBlock, ToolCallCard, BrandIcons
      └── crypto/      # CryptoManager (E2E)
```

### 0.2 事件流 — CLI → Relay → Android

```
Claude/Codex/Gemini API
  ↓ streaming
Adapter (claude-adapter.ts / codex-adapter.ts / gemini-adapter.ts)
  ↓ NormalizedEvent { kind, text/thinking/tool/... }
dispatch.ts — switch(ev.kind) → sendEnvelope(MessageType, payload)
  ↓ Encrypted Envelope { id, seq, source, target, type, payload(encrypted) }
Relay Server — route to target device (persist if not transient)
  ↓ Socket.IO "message" event
Android RelayClient — decrypt → ChatViewModel.handleEnvelope()
  ↓ when(type) — 22 个 case 分支 (L1390-1978)
ChatItem → _items StateFlow → Compose UI
```

### 0.3 协议层关键事实

| 维度 | 现状 | 来源 |
|------|------|------|
| 消息类型总数 | 60+ 定义于 `packages/shared/src/types.ts` | L2-71 |
| CLI 实际分发的类型 | 10 种 (text, thinking, tool_call, tool_result, file_diff, hook_event, error, status, usage, raw) | `dispatch.ts` L16-131 |
| Android 处理的类型 | 22 种 (含 heartbeat, turn_state, interaction_state, rpc_resp 等) | `ChatViewModel.kt` L1390-1978 |
| 非持久化类型 | stream_chunk, thinking, heartbeat, status, interaction_state, terminal_output | `relay-server/index.ts` L94-101 |
| ACK 机制 | 仅 prompt, approval_resp, session_switch_ack, diff_action_result | CLI ACK_REQUIRED_TYPES |

### 0.4 产品方法论 — HAPI 而非 Happy

| 方面 | HAPI 模式 (Yuanio 应遵循) | Happy 模式 (避免) |
|------|------|------|
| 会话权威 | 桌面端持有权威状态，手机是远程表面层 | 手机可以"restart in remote mode" |
| 审批中转 | 通过 Relay/REST/SSE 中转，手机只是视图 | 直接控制 CLI 进程 |
| 架构层次 | protocol → core → state → UI (Codex 式分层) | Wrapper + UI 一体 |
| 业务真相 | 保留在共享协议层和 CLI 端 | 可能塞回 Android |

---

## 1. Product Vision & The 6 Pillars

### 1.1 核心设计理念

> **"不是把终端塞进手机，而是让手机理解终端正在做什么。"**

- **CLI-Native → Mobile-Adaptive**：保留 CLI 的专业深度，用移动端原生交互语言重新表达
- **Agent-Aware UI**：UI 根据 agent 类型（claude/codex/gemini）自适应配色、能力和事件粒度
- **Context-Dense Minimalism**：在最小视觉面积内传递最大信息密度，同时保持呼吸感

### 1.2 六大支柱

| 支柱 | 策略 | 现状 | Gap |
|------|------|------|-----|
| **高性能** | LazyColumn key+contentType；流式消息独立 StateFlow；Markdown 渲染缓存 | 已有 16ms 帧节流 + 深度感知批处理 (`ChatViewModel.kt` L943-960) | key 基于索引串接不够稳定；MarkdownText 每次 stream chunk 全量切块 |
| **轻量** | ChatViewModel 拆分；ChatInputBar 参数收敛 | 单文件 4098 行；ChatItem 内嵌 ViewModel | 需提取 ChatItem + 事件解析逻辑 |
| **交互好** | 审批类型化卡片；手势系统 | 审批已有完整 BottomSheet/queue/undo/批量操作/通知 | 审批卡片无按类型分发布局；缺少 Auto-Reject 安全兜底 |
| **速度快** | 消息分页；Compose Stability 审计 | 全量 `List<ChatItem>` 在 StateFlow | 长对话需分页策略 |
| **美观** | Geist 三级层级；双图标系统 | 已有 GeistNeutral/GeistFunctional 色彩体系 (`Theme.kt`) | 缺少 L1/L2/L3 Shape Token；图标未统一到 Tabler+Lobe |
| **简约** | 渐进式披露；Timeline 折叠 | 部分组件已折叠（ThinkingBlock） | 缺 3 步以上自动 Timeline 化 |

---

## 2. Design System & Assets

### 2.1 Geist Visual Hierarchy — Theme Tokens

**现状**: `Theme.kt` (207 行) 已有 `GeistNeutral`(Gray050-Gray1000), `GeistFunctional`(Blue/Red/Amber/Green 700/500), `YuanioColors`(agent-specific colors)

**已有能力**: 暗色/亮色主题切换；Agent 配色（agentClaude=Amber, agentCodex=Green, agentGemini=Blue）

**Gap**: 无 L1/L2/L3 Shape Token；无 AMOLED 专用 Surface 色彩

**目标**: 扩展 Theme Token，添加 `YuanioShapes`(L1=8dp, L2=12dp, L3=16dp) 和 `YuanioSurfaces`(AMOLED backgrounds)

```kotlin
// 新增到 android-app/app/src/main/java/com/yuanio/app/ui/theme/Theme.kt

@Immutable
data class YuanioShapes(
    val level1: RoundedCornerShape,  // 消息气泡、状态芯片
    val level2: RoundedCornerShape,  // ToolCallGroup、ThinkingBlock
    val level3: RoundedCornerShape,  // ApprovalCard、BottomSheet
)
val YuanioShapesDefault = YuanioShapes(
    level1 = RoundedCornerShape(8.dp),
    level2 = RoundedCornerShape(12.dp),
    level3 = RoundedCornerShape(16.dp),
)

@Immutable
data class YuanioSurfaces(
    val chatBackground: Color,
    val codeBlockBackground: Color,
    val diffAddBackground: Color,
    val diffRemoveBackground: Color,
    val inputBarBackground: Color,
)
private val DarkSurfaces = YuanioSurfaces(
    chatBackground = Color(0xFF000000),       // AMOLED 纯黑
    codeBlockBackground = Color(0xFF0D0D0D),
    diffAddBackground = Color(0xFF0D2818),    // 极淡绿
    diffRemoveBackground = Color(0xFF2D0F0F), // 极淡红
    inputBarBackground = Color(0xFF0A0A0A),
)
```

**验证**: `./gradlew assembleDebug` 编译通过 + 手动检查 AMOLED 模式色值

### 2.2 Dual-Icon System (Tabler vs Lobe)

**现状**: 使用 Tabler drawable (`ic_tb_*`)；BrandIcon composable 已存在但部分使用 tint 着色

**已有能力**: `BrandIcon` composable, `agentToBrand()`, `agentColor()` 函数均已实现

**Gap**: UI 操作图标未迁移到 Tabler；Lobe Icons 部分被 tint 覆盖了原彩色

| 用途 | 图标库 | 着色规则 | 来源 |
|------|--------|----------|------|
| UI 操作 (返回/搜索/折叠) | Tabler Icons, Outline 2.0px | `onSurface` tint | `refer/compose-icons-main/icons-tabler-outline-android` |
| AI Agent 头像 | Lobe Icons, Filled | **严禁 tint**，原彩色 | `refer/lobe-icons-master` |
| 底部导航栏 | Tabler Icons | Outline(未选) / Filled(选中) | `icons-tabler-outline/filled-android` |

**迁移清单**:

| 文件 (仓库根相对路径) | 当前 | 替换为 |
|------|------|--------|
| `android-app/.../ui/component/MainBottomBar.kt` L18-19 | `ic_tb_message_circle` 等 | `TablerIcons.MessageCircle` 等 |
| `android-app/.../ui/component/ApprovalCard.kt` L39 | `ic_tb_alert_triangle` | `TablerIcons.AlertTriangle` |
| `android-app/.../ui/component/ThinkingBlock.kt` | Chevron icons | `TablerIcons.ChevronDown` |

---

## 3. Cross-Stack Architecture

### 3.1 Single Activity & Compose Navigation

**现状**: ✅ **已完全实现**

| 组件 | 文件 | 状态 |
|------|------|------|
| 唯一 Activity | `android-app/.../MainActivity.kt` L37 | existing |
| NavHost + 8 路由 | `android-app/.../ui/navigation/NavGraph.kt` L26 | existing |
| 5 Tab 底栏 | `android-app/.../ui/component/MainBottomBar.kt` | existing |
| Screen sealed class | `android-app/.../ui/navigation/Screen.kt` (8 routes) | existing |

**无需改动**。保持现有架构。

### 3.2 连接管理

**现状**: ✅ **已完全实现**

| 组件 | 文件 | 能力 |
|------|------|------|
| 远程连接 | `android-app/.../data/RelayClient.kt` (100 行) | Socket.IO + auth + reconnection + ACK |
| 本地连接 | `android-app/.../data/LocalRelayClient.kt` (137 行) | Native WebSocket + HMAC-SHA256 认证 |
| 信封加解密 | `android-app/.../data/EnvelopeHelper.kt` (107 行) | AES-GCM 加密/解密 |
| 双模式选择 | `android-app/.../ui/screen/SettingsScreen.kt` | AUTO/RELAY/LOCAL 模式切换 |

**无需改动**。连接层保持现状。

### 3.3 GlobalSessionManager ? ??? P5

**??**: `SessionGateway` / `DefaultSessionGateway` ?????? session ?????`ChatViewModel` ??? gateway ???????Terminal / Files ???????????

**??**:
1. ???? `GlobalSessionManager`
2. ? `SessionGateway` ??? Screen ??????
3. `YuanioApp` ???????????? Prefs ???????
4. `Hilt` ????????????????

**2026-03-09 ??**:
- `GlobalSessionManager` ?????????????
- `SessionGateway` / `DefaultSessionGateway` ???????????????

### 3.4 Feature Flags — 复用现有 Prefs 模式（P3 起引入）

**现状**: 项目已有 `SharedPreferences`/`EncryptedSharedPreferences` 管理偏好（`TerminalPrefs`, `NotificationPrefs`, `TtsPrefs` 等，全部通过 `YuanioApp.kt` L27-36 初始化）

**边界**: `FeaturePrefs` 不属于 P0。P0 仅负责“协议事件解析对齐 + `ChatViewModel` 接入”；所有 behind-flag 能力从 P3 开始落地。

**目标**: 不引入抽象 DSL，直接复用现有模式：

```kotlin
// android-app/.../data/FeaturePrefs.kt (新建)
object FeaturePrefs {
    private lateinit var prefs: SharedPreferences
    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("feature_prefs", MODE_PRIVATE) }

    var approvalAutoReject: Boolean
        get() = prefs.getBoolean("approval_auto_reject", false)  // 默认关闭
        set(v) = prefs.edit().putBoolean("approval_auto_reject", v).apply()

    var timelineCollapse: Boolean
        get() = prefs.getBoolean("timeline_collapse", true)
        set(v) = prefs.edit().putBoolean("timeline_collapse", v).apply()

    // ... 其他 flag
}

// YuanioApp.kt onCreate() 中加一行:
FeaturePrefs.init(this)
```

---

## 4. Existing Capabilities Audit

> 以下能力已完全实现，蓝图任何阶段不得声称需要重建。

### 4.1 审批系统 — ✅ 完全实现

| 能力 | 位置 | 行号 |
|------|------|------|
| 紧急审批弹窗 (ModalBottomSheet + haptic) | `ChatScreen.kt` | L1256-1300 |
| 审批队列管理 (pending queue + filtering) | `ChatScreen.kt` | L1303-1344 |
| 时间线视图 (timeline + jump-to-message) | `ChatScreen.kt` | L1347-1400 |
| 批量批准低风险 (`approveAllSafe`) | `ChatViewModel.kt` | L3385-3415 |
| 批量批准/拒绝所有 | `ChatViewModel.kt` | L3385-3415 |
| 审批撤销窗口 (600ms configurable) | `ChatViewModel.kt` | L3530-3620 |
| 离线缓存 (PendingApprovalStore) | `ChatViewModel.kt` | L3530-3620 |
| 加密审批响应发送 | `ChatViewModel.kt` | commitApprovalResponse() |
| FCM 推送通知 | `FCMService.kt` | approval_requested 事件 |

### 4.2 流式节流 — ✅ 完全实现

| 参数 | 值 | 位置 |
|------|------|------|
| 帧间隔 | `streamTickMs = 16L` (~60fps) | `ChatViewModel.kt` L943 |
| 进入流控阈值 | `streamEnterDepth = 8` | L944 |
| 退出流控阈值 | `streamExitDepth = 2` | L946 |
| 严重积压阈值 | `streamSevereDepth = 64` | L949 |
| 退出保持 | `streamExitHoldMs = 250L` | L948 |
| 重入阻塞 | `streamReenterHoldMs = 250L` | L949 |

含 `streamBuffer`, `streamChunkQueue`, `streamChunkLock`, `streamCommitJob`, `streamCatchUpMode` 全套状态机。

### 4.3 Terminal — ✅ 功能完备

| 能力 | 位置 |
|------|------|
| 多标签页管理 | `TerminalScreen.kt` L104+ |
| 搜索 (query, results, cursor, history) | TerminalSearchHelper |
| Profile 配置 (shell, cwd, colorScheme) | TerminalPrefs |
| 快速命令 (edit/delete) | quickCommands |
| 字体大小控制 | fontSize slider |
| 主题切换 | TerminalTheme |
| 标签页持久化 | saveTabSnapshot/restoreTabs |
| SSH 连接 | SshProfile/SshConnectionManager |
| 键盘快捷键 | TerminalKeyboardShortcuts |
| Quake 模式 | QuakeModeTerminal |
| 配色管理 | ColorSchemeManager |

### 4.4 其他已完备屏幕

| 屏幕 | 关键能力 | 文件 |
|------|----------|------|
| **FileManager** | 文件过滤/搜索/上传/下载/编辑/OCR/目录浏览/Git 状态 | `FileManagerScreen.kt` |
| **Skills** | 三标签(LIST/INSTALL/LOGS)/范围过滤/批量操作/安装追踪 | `SkillsScreen.kt` |
| **Settings** (1427 行) | 连接模式/安全/语言/主题/终端/通知/TTS/IM集成/数据管理 | `SettingsScreen.kt` |
| **Git** | 三标签(STATUS/LOG/BRANCH)/diff查看/分支管理 | `GitScreen.kt` |
| **ChatHistory** | 加密存储/会话搜索/标签/标题编辑/去重 | `ChatHistory.kt` (115 行) |

---

## 5. Protocol Gap Analysis

### 5.1 CLI Dispatch 与 Android 解析的对齐矩阵

| NormalizedEvent kind | CLI dispatch → MessageType | Android handler | 状态 |
|---|---|---|---|
| `text` | `STREAM_CHUNK` (plain text) | `ChatViewModel.kt` L1432 | ✅ 对齐 |
| `thinking` | `THINKING` (JSON payload) | L1512 | ✅ 对齐 |
| `tool_call` | `TOOL_CALL` (JSON payload) | L1567 | ✅ 对齐 |
| `tool_result` | `TOOL_CALL` (status=done) | L1567 | ✅ 对齐 |
| `file_diff` | `FILE_DIFF` (JSON payload) | L1641 | ✅ 对齐 |
| `hook_event` | `HOOK_EVENT` (JSON payload) | L1896 | ✅ 对齐 |
| `usage` | `USAGE_REPORT` (JSON cumulative) | L1614 | ✅ 对齐 |
| `error` | `STREAM_CHUNK` (text `[ERROR]`) | L1432 (作为文本) | ⚠️ 无区分 |

**P0 Constraint Note**: keep `error` as `STREAM_CHUNK` text fallback in the current contract. Do not add an Android-only error card before shared protocol and CLI dispatch are extended.
| `status` | 条件跳过 | L1669 | ⚠️ 部分 |

### 5.2 Android 解析了但 CLI 不分发的类型

| MessageType | Android handler | 实际来源 | 备注 |
|---|---|---|---|
| `TURN_STATE` | L1734 | Relay server 合成 | ❌ CLI 不 dispatch |
| `INTERACTION_STATE` | L1754 | Android 从 turn state 合成 | ❌ 非协议消息 |
| `FOREGROUND_PROBE_ACK` | L1808 | Relay server 回复 | N/A (心跳探测) |
| `REPLAY_DONE` | L1792 | Relay server 发送 | N/A (恢复协议) |
| `RPC_RESP` | L1863 | CLI rpc-server | ⚠️ 独立通道 |
| `APPROVAL_REQ` | L1906 | CLI approval-server | ⚠️ 独立于 adapter dispatch |

### 5.3 已定义但两端都未实现

| MessageType | 设计意图 | 计划 |
|---|---|---|
| `SESSION_SPAWN/STOP/LIST/STATUS` | 远程会话生命周期 | 未来 Phase |
| `TASK_QUEUE/TASK_QUEUE_STATUS/TASK_SUMMARY` | 任务队列管理 | 未来 Phase |
| `SCHEDULE_*` (5 types) | 定时任务 | 未来 Phase |
| `RPC_REGISTER/UNREGISTER` | 动态 RPC | 未来 Phase |
| `CANCEL` | 取消操作 | 待设计 |

### 5.4 关键 Gap — Android 事件解析的问题

**问题**: `ChatViewModel.kt` L1390-1978 的 `when(type)` 分支直接手写 JSON 解析，与 `packages/shared/src/types.ts` 中的 Payload 接口无类型安全保证。

**具体风险**:
1. `ToolCallPayload.status` 在 TypeScript 中是 `"running"|"done"|"error"`，Android 用 `optString("status")` 无校验
2. `ApprovalReqPayload` 在 TypeScript 有 `riskLevel`, `context`, `preview`, `permissionMode`，Android 仅解析部分字段
3. `ThinkingPayload` TypeScript 有 `done`, `phase`, `elapsedMs` 字段，Android 未使用

**目标**: 提取 `AgentEventParser`，对齐 shared payload 接口的全部字段

---

## 6. ChatItem Model Specification

### 6.1 现状 (内嵌于 ChatViewModel.kt L58-111)

```kotlin
sealed class ChatItem {
    abstract val agent: String?
    data class Text(val role, val content, val ts, val failed, val delivery, val id, ...) : ChatItem()
    data class Thinking(val content, val turnId, val ephemeral, ...) : ChatItem()
    data class ToolCall(val tool, val status: String, val result, val summary, val toolUseId, ...) : ChatItem()
    data class UsageInfo(val inputTokens, val outputTokens, val cacheCreationTokens, ...) : ChatItem()
    data class FileDiff(val path, val diff, val action, ...) : ChatItem()
    data class Approval(val id, val desc, val tool, val files, val riskLevel, ...) : ChatItem()
    data class HookEvent(val hook, val event, val tool, ...) : ChatItem()
    data class TodoUpdate(val todos, val taskId, ...) : ChatItem()
}
```

### 6.2 重构后 (独立文件 + stableKey + 类型增强)

```kotlin
// android-app/.../ui/model/ChatItem.kt (新建)

@Immutable
sealed class ChatItem {
    abstract val stableKey: String   // LazyColumn 稳定 key
    abstract val agent: String?

    data class Text(
        val role: String,            // "user" | "ai" | "system"
        val content: String,
        val ts: Long = System.currentTimeMillis(),
        val failed: Boolean = false,
        val delivery: DeliveryStatus? = null,
        val id: String = "msg_${System.currentTimeMillis()}_${(1000..9999).random()}",
        val editedCount: Int = 0,
        val editedAt: Long? = null,
        val originalContent: String? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = id
    }

    data class Thinking(
        val content: String,
        val turnId: String? = null,
        val ephemeral: Boolean = false,
        val done: Boolean = false,               // 对齐 ThinkingPayload.done
        val phase: String? = null,               // 对齐 ThinkingPayload.phase
        val elapsedMs: Long? = null,             // 对齐 ThinkingPayload.elapsedMs
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "thinking_${turnId ?: content.hashCode()}"
    }

    data class ToolCall(
        val tool: String,
        val status: ToolCallStatus,              // 枚举替代 String
        val result: String? = null,
        val summary: String? = null,
        val toolUseId: String? = null,
        val durationMs: Long? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "tool_${toolUseId ?: "${tool}_${hashCode()}"}"
    }

    // 仅保留 CLI dispatch 实际发送的 3 种状态 + 审批等待
    enum class ToolCallStatus {
        RUNNING,              // status="running" — CLI dispatch.ts L40
        SUCCESS,              // status="done"    — CLI dispatch.ts L52
        ERROR,                // status="error"   — CLI dispatch.ts
        AWAITING_APPROVAL,    // 审批等待态       — 从 approval_req 推断
    }

    data class UsageInfo(
        val inputTokens: Int = 0,
        val outputTokens: Int = 0,
        val cacheCreationTokens: Int = 0,
        val cacheReadTokens: Int = 0,
        val taskId: String? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        val totalTokens get() = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
        override val stableKey get() = "usage_${taskId ?: totalTokens}"
    }

    data class FileDiff(
        val path: String,
        val diff: String,
        val action: String,  // "created" | "modified" | "deleted" — 对齐 FileDiffPayload
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "diff_${path.hashCode()}_${diff.hashCode()}"
    }

    data class Approval(
        val id: String,
        val approvalType: ApprovalType = ApprovalType.GENERIC,
        val desc: String,
        val tool: String,
        val files: List<String> = emptyList(),
        val riskLevel: String = "medium",
        val riskSummary: String = "",
        val diffHighlights: List<String> = emptyList(),
        // 对齐 ApprovalReqPayload 的 preview/context/permissionMode
        val preview: String? = null,
        val context: String? = null,
        val permissionMode: String? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "approval_$id"
    }

    // 基于 CLI ApprovalReqPayload.tool 推断
    enum class ApprovalType { EXEC, EDIT, MCP, GENERIC }

    data class HookEvent(
        val hook: String,
        val event: String,
        val tool: String?,
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "hook_${hook}_${event.hashCode()}"
    }

    data class TodoUpdate(
        val todos: List<TodoItem>,
        val taskId: String? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        override val stableKey get() = "todo_${taskId ?: todos.hashCode()}"
    }
}
```

### 6.3 对齐 shared/types.ts 的设计决策

| 决策 | 理由 |
|------|------|
| `ToolCallStatus` 保留 4 种而非 7 种 | CLI dispatch.ts 实际只发 running/done/error 三种；Gemini 的 VALIDATING/SCHEDULED 不通过当前协议传输 |
| `Thinking` 添加 `done`/`phase`/`elapsedMs` | 对齐 `ThinkingPayload` (types.ts L229)，CLI 已在 dispatch.ts L30-37 发送这些字段 |
| `Approval` 添加 `preview`/`context`/`permissionMode` | 对齐 `ApprovalReqPayload` (types.ts L251-262)，CLI approval-server 已发送 |
| `ApprovalType` 去掉 `ASK_USER` | 当前协议无 ask_user 审批类型，避免 YAGNI |
| `FileDiff.action` 保留 String 而非枚举 | 对齐 TypeScript `"created"|"modified"|"deleted"`，避免额外映射层 |

---

## 7. Agent Event Fixtures

> 每种 agent 的典型事件序列，用于验证 `AgentEventParser` 正确性。

### 7.1 Claude Code 典型序列

```json
// 1. Thinking
{"type":"thinking","payload":"{\"thinking\":\"Let me analyze...\",\"turnId\":\"turn_1\",\"agent\":\"claude\",\"ephemeral\":false,\"done\":false}"}

// 2. Tool call (running)
{"type":"tool_call","payload":"{\"tool\":\"Read\",\"params\":{\"file_path\":\"src/main.kt\"},\"status\":\"running\",\"toolUseId\":\"tu_001\",\"agent\":\"claude\"}"}

// 3. Tool call (done)
{"type":"tool_call","payload":"{\"tool\":\"Read\",\"params\":{},\"result\":\"file contents...\",\"status\":\"done\",\"toolUseId\":\"tu_001\",\"agent\":\"claude\"}"}

// 4. Approval request
{"type":"approval_req","payload":"{\"id\":\"apv_001\",\"description\":\"Write file src/index.ts\",\"tool\":\"Write\",\"affectedFiles\":[\"src/index.ts\"],\"riskLevel\":\"medium\",\"riskSummary\":\"File modification\",\"permissionMode\":\"default\"}"}

// 5. File diff
{"type":"file_diff","payload":"{\"path\":\"src/index.ts\",\"diff\":\"@@ -1,3 +1,5 @@\\n+import { foo } from './foo'\\n ...\",\"action\":\"modified\"}"}

// 6. Stream text
{"type":"stream_chunk","payload":"Here is the refactored code:"}

// 7. Stream end
{"type":"stream_end","payload":""}

// 8. Usage
{"type":"usage_report","payload":"{\"taskId\":\"task_1\",\"usage\":{\"inputTokens\":1500,\"outputTokens\":800,\"cacheCreationTokens\":200,\"cacheReadTokens\":100},\"cumulative\":true}"}
```

### 7.2 Codex 典型序列 (通过 Yuanio adapter 归一化后)

```json
// Codex adapter 将 AgentReasoning* 归一化为 thinking kind
// dispatch.ts 再转为标准 THINKING 消息
{"type":"thinking","payload":"{\"thinking\":\"I need to check...\",\"turnId\":\"turn_c1\",\"agent\":\"codex\",\"done\":false}"}

// ExecApprovalRequest 归一化为 approval_req
{"type":"approval_req","payload":"{\"id\":\"apv_c1\",\"description\":\"Execute: npm test\",\"tool\":\"Bash\",\"affectedFiles\":[],\"riskLevel\":\"medium\",\"riskSummary\":\"Shell command execution\"}"}

// 工具调用同样归一化
{"type":"tool_call","payload":"{\"tool\":\"Bash\",\"params\":{\"command\":\"npm test\"},\"status\":\"running\",\"toolUseId\":\"tu_c1\",\"agent\":\"codex\"}"}
```

### 7.3 Gemini CLI 典型序列 (通过 Yuanio adapter 归一化后)

```json
// Gemini adapter 将 CoreToolCallStatus 归一化为 tool_call kind
{"type":"tool_call","payload":"{\"tool\":\"WriteFile\",\"params\":{\"path\":\"src/app.ts\"},\"status\":\"running\",\"toolUseId\":\"tu_g1\",\"agent\":\"gemini\"}"}

// ConfirmationDetails 归一化为 approval_req
{"type":"approval_req","payload":"{\"id\":\"apv_g1\",\"description\":\"Edit file src/app.ts\",\"tool\":\"WriteFile\",\"affectedFiles\":[\"src/app.ts\"],\"riskLevel\":\"high\",\"riskSummary\":\"File creation\"}"}
```

**关键洞察**: 三种 agent 在经过 Yuanio CLI adapter + dispatch.ts 归一化后，到达 Android 的消息格式完全统一。Android 端不需要感知 agent 差异（差异已在 CLI 层消化）。

---

## 8. Core Component Specifications

### 8.1 AgentEventParser — 从 ChatViewModel 提取事件解析

**现状**: `ChatViewModel.kt` L1390-1978 的 `when(type)` 分支，22 个 case，直接操作 `_items` 等 StateFlow

**目标**: 纯函数式事件解析器，输入 JSON → 输出 `ParsedEvent` sealed class。

**实现契约**:
- 不依赖 Android `Context`、`ViewModel`、`StateFlow`、通知或存储。
- 不产生副作用；只负责“解析”和“归一化”，不负责“提交到 UI/状态”。
- 以 §7 的 Claude / Codex / Gemini fixtures 作为唯一协议基线。
- 对未知类型返回 `null` 或可跳过结果，而不是在 Android 侧抢先扩展协议。

```kotlin
// android-app/.../data/AgentEventParser.kt (新建)

sealed class ParsedEvent {
    data class StreamChunk(val text: String) : ParsedEvent()
    data class StreamEnd(val empty: Boolean = true) : ParsedEvent()
    data class ThinkingUpdate(val item: ChatItem.Thinking) : ParsedEvent()
    data class ToolCallUpdate(val item: ChatItem.ToolCall) : ParsedEvent()
    data class UsageUpdate(val item: ChatItem.UsageInfo) : ParsedEvent()
    data class FileDiffReceived(val item: ChatItem.FileDiff) : ParsedEvent()
    data class ApprovalReceived(val item: ChatItem.Approval) : ParsedEvent()
    data class HookReceived(val item: ChatItem.HookEvent) : ParsedEvent()
    data class TodoReceived(val item: ChatItem.TodoUpdate) : ParsedEvent()
    data class HeartbeatReceived(val heartbeat: AgentHeartbeat) : ParsedEvent()
    data class TurnStateChanged(val state: TurnState) : ParsedEvent()
    data class StatusUpdate(val agentState: String, val turnState: String?) : ParsedEvent()
    // ... 其他 case
}

class AgentEventParser {
    /**
     * 纯函数: 解析解密后的 payload，不产生副作用
     * @param type 消息类型 (envelope.type)
     * @param payload 解密后的 payload 字符串
     * @param agent 当前 agent 类型 (可选)
     * @return ParsedEvent 或 null (未知类型)
     */
    fun parse(type: String, payload: String, agent: String? = null): ParsedEvent? {
        return when (type) {
            "stream_chunk" -> ParsedEvent.StreamChunk(payload)
            "stream_end" -> ParsedEvent.StreamEnd()
            "thinking" -> parseThinking(payload, agent)
            "tool_call" -> parseToolCall(payload, agent)
            "approval_req" -> parseApproval(payload, agent)
            "file_diff" -> parseFileDiff(payload, agent)
            "usage_report" -> parseUsage(payload, agent)
            "hook_event" -> parseHookEvent(payload, agent)
            "todo_update" -> parseTodo(payload, agent)
            "heartbeat" -> parseHeartbeat(payload)
            "status" -> parseStatus(payload)
            "turn_state" -> parseTurnState(payload)
            // ... 其他
            else -> null
        }
    }

    private fun parseThinking(payload: String, agent: String?): ParsedEvent.ThinkingUpdate {
        val obj = JSONObject(payload)
        return ParsedEvent.ThinkingUpdate(ChatItem.Thinking(
            content = obj.optString("thinking", ""),
            turnId = obj.optString("turnId", null),
            ephemeral = obj.optBoolean("ephemeral", false),
            done = obj.optBoolean("done", false),           // 对齐 ThinkingPayload
            phase = obj.optString("phase", null),            // 对齐 ThinkingPayload
            elapsedMs = obj.optLong("elapsedMs", -1).takeIf { it >= 0 },
            agent = obj.optString("agent", null) ?: agent,
        ))
    }

    private fun parseApproval(payload: String, agent: String?): ParsedEvent.ApprovalReceived {
        val obj = JSONObject(payload)
        val tool = obj.optString("tool", "")
        return ParsedEvent.ApprovalReceived(ChatItem.Approval(
            id = obj.optString("id", ""),
            approvalType = inferApprovalType(tool),  // 从 tool 名推断类型
            desc = obj.optString("description", ""),
            tool = tool,
            files = obj.optJSONArray("affectedFiles")?.let { arr ->
                (0 until arr.length()).map { arr.getString(it) }
            } ?: emptyList(),
            riskLevel = obj.optString("riskLevel", "medium"),
            riskSummary = obj.optString("riskSummary", ""),
            diffHighlights = obj.optJSONArray("diffHighlights")?.let { arr ->
                (0 until arr.length()).map { arr.getString(it) }
            } ?: emptyList(),
            preview = obj.optString("preview", null),
            context = obj.optString("context", null),
            permissionMode = obj.optString("permissionMode", null),
            agent = agent,
        ))
    }

    private fun inferApprovalType(tool: String): ChatItem.ApprovalType = when {
        tool.equals("Bash", true) || tool.equals("exec", true) -> ChatItem.ApprovalType.EXEC
        tool.equals("Write", true) || tool.equals("Edit", true) -> ChatItem.ApprovalType.EDIT
        tool.startsWith("mcp_", true) -> ChatItem.ApprovalType.MCP
        else -> ChatItem.ApprovalType.GENERIC
    }
    // ... 其他 parse 方法
}
```

### 8.2 DiffViewer — 新组件

**Gap**: 当前 `ChatItem.FileDiff` 只在消息列表中显示路径和 action，无 inline diff 渲染

**规格**:

```kotlin
// android-app/.../ui/component/DiffViewer.kt (新建)

@Composable
fun DiffViewer(
    path: String,
    diff: String,
    action: String,
    modifier: Modifier = Modifier,
    defaultExpanded: Boolean = false,
) {
    var expanded by remember { mutableStateOf(defaultExpanded) }
    val lines = remember(diff) { parseDiffLines(diff) }
    val stats = remember(lines) {
        DiffStats(
            additions = lines.count { it.type == DiffLineType.ADD },
            deletions = lines.count { it.type == DiffLineType.REMOVE },
        )
    }
    // FileHeader (clickable to expand/collapse)
    // AnimatedVisibility { DiffLines (max-height 300dp, scrollable) }
    // Geist 极淡红绿: diffAddBackground=#0D2818, diffRemoveBackground=#2D0F0F
}

data class DiffLine(
    val content: String,
    val type: DiffLineType,
    val oldLineNo: Int?,
    val newLineNo: Int?,
)
enum class DiffLineType { ADD, REMOVE, CONTEXT }

fun parseDiffLines(diff: String): List<DiffLine> { /* unified diff parser */ }
```

### 8.3 ApprovalCard — 类型化重构

**现状**: `ApprovalCard.kt` (140 行) 9 个参数，所有审批类型共用一个布局

**已有能力**: 风险等级着色 (`riskColor`/`riskLabel`)、Agent badge、diff highlights、文件列表

**Gap**: 无按 `ApprovalType` 分发的差异化布局

**目标**: 保留现有参数和布局作为默认，新增按类型分发的子布局:

```kotlin
// 在 ApprovalCard 内部按 approvalType 分发:
when (approvalType) {
    ApprovalType.EXEC -> {
        // 显示 command preview (monospace, dark bg)
        // 显示 cwd
    }
    ApprovalType.EDIT -> {
        // 显示 filePath
        // 内嵌 DiffViewer (max 8 lines preview)
    }
    ApprovalType.MCP -> {
        // 显示 server + tool name
        // 显示 args preview (JSON collapsible)
    }
    ApprovalType.GENERIC -> {
        // 保留现有布局 (向后兼容)
    }
}
```

### 8.4 Markdown 渲染优化 — 两级策略

**设计理念**: 先做最小有效优化，有 profiling 证据再做增量引擎

**Level 1 — remember 缓存 + append-only 优化 (P1 实施)**:

```kotlin
// 修改 ChatMessageList 中对流式消息的处理:

// 已完成消息: remember 缓存解析结果
items(items = completedMessages, key = { it.stableKey }, contentType = { it::class }) { item ->
    when (item) {
        is ChatItem.Text -> {
            val parsed = remember(item.content) { splitCodeBlocks(item.content) }
            MarkdownText(parsed)  // 零重组合
        }
        // ...
    }
}

// 流式消息: 独立 item，仅此一条参与重组合
if (isStreaming) {
    item(key = "streaming", contentType = "streaming") {
        val text by streamText.collectAsState()
        MarkdownText(splitCodeBlocks(text))  // 仅最后一条消息重组合
    }
}
```

**Level 2 — StreamingMarkdown 增量引擎 (P4 按需实施)**:

仅当 Level 1 的 Compose Metrics 显示性能不足时才实施。设计方案保留在蓝图中但不列入必做项。

---

## 9. Phased Implementation Roadmap

### 依赖关系 DAG

```
P0 (契约层)
  ↓
P1 (聊天模型层)
  ↓
P2 (输入层) ←── 可与 P3 并行
  ↓
P3 (审批层)
  ↓
P4 (性能层) ←── 依赖 P1-P3 稳定
  ↓
P5 (会话共享层) ←── 依赖 P4 稳定
  ↓
P6 (Terminal 增强) ←── 依赖 P5
```

---

### P0: 契约层 — 事件解析从 ChatViewModel 拔出

**目标**: 将 Android 事件解析与 shared protocol 对齐，不改变 UI 行为。

**P0 边界（必须遵守）**:
- 只做 `Envelope/MessageType` → Android 域事件/聊天模型 的收敛，以及 `ChatViewModel` 接入。
- 不引入 `Hilt`、`GlobalSessionManager`、`FeaturePrefs`、分页策略、视觉改版。
- 不新增任何“上游协议未提供”的 Android 专属状态或字段。

| # | 内容 | 产出文件 (仓库根相对路径) | 类型 | 依赖 |
|---|------|--------------------------|------|------|
| 0.1 | 提取 `ChatItem` sealed class 到独立文件，添加 `stableKey` + 类型增强 | `android-app/.../ui/model/ChatItem.kt` (新) | 提取 | - |
| 0.2 | 提取 `AgentEventParser` – 纯函数式事件解析，对齐 `shared/types.ts` / `dispatch.ts` 已落地字段 | `android-app/.../data/AgentEventParser.kt` (新) | 提取 | 0.1 |
| 0.3 | 用 Claude / Codex / Gemini fixture 建立解析契约测试，作为 `AgentEventParser` 的唯一输入基线 | `android-app/.../test/.../AgentEventParserTest.kt` (新) | 新建 | 0.2 |
| 0.4 | 重构 `ChatViewModel.handleEnvelope()` – 委托给 `AgentEventParser`，保留副作用逻辑 | `android-app/.../ui/screen/ChatViewModel.kt` (重构) | 重构 | 0.2, 0.3 |

**P0 完成判定**:
- Android 不再在 `ChatViewModel` 内手写大段 JSON 分支解析。
- `AgentEventParser` 通过 fixture-first 单测覆盖三类 agent 的典型事件序列。
- 重构前后 UI 行为保持一致，仅内部解析职责迁移。

**验证**:
- `./gradlew assembleDebug` 编译通过
- 手动测试: 连接 Agent → 发送 prompt → 收到流式回复/工具调用/审批 – 行为与重构前完全一致
- `AgentEventParser` 单元测试: 用 §7 的 3 组 fixture 验证解析正确性

---

### P1: 聊天模型层 — 稳定 key、contentType、Markdown 缓存

**目标**: LazyColumn 性能基线 + Markdown remember 缓存

**依赖**: P0.1 (ChatItem.stableKey)

| # | 内容 | 产出文件 | 类型 |
|---|------|----------|------|
| 1.1 | `ChatMessageList.kt` 添加 `key = { it.stableKey }` + `contentType = { it::class }` | `android-app/.../ui/chat/ChatMessageList.kt` (重构) | 重构 |
| 1.2 | 流式消息拆为独立 `item(key="streaming")` — 仅此一条参与重组合 | 同上 | 重构 |
| 1.3 | 已完成消息的 `MarkdownText` 添加 `remember(content)` 缓存 | `android-app/.../ui/component/MarkdownText.kt` (增强) | 增强 |
| 1.4 | 扩展 `Theme.kt` — 添加 `YuanioShapes` + `YuanioSurfaces` Token | `android-app/.../ui/theme/Theme.kt` (增强) | 增强 |
| 1.5 | 启用 Compose 编译器 metrics 报告 | `android-app/app/build.gradle.kts` | 配置 |

**验证**:
```bash
# 编译
cd android-app && ./gradlew assembleDebug

# Compose Metrics (检查 ChatItem 子类是否被标记为 Stable)
cat app/build/compose_metrics/*-composables.txt | grep -E "restartable|skippable"

# 手动: 发送长回复 (1000+ 字), 观察是否流畅
```

---

### P2: 输入层 — ChatInputBar 参数收敛

**目标**: 54 参数收敛为 `InputBarState` 数据类 + 子组件拆分

**依赖**: 无 (可与 P3 并行)

| # | 内容 | 产出文件 | 类型 |
|---|------|----------|------|
| 2.1 | 定义 `InputBarState` 数据类 | `android-app/.../ui/chat/InputBarState.kt` (新) | 新建 |
| 2.2 | 提取 `ChipRow.kt` (AgentChip + ModelChip + PermissionChip) | `android-app/.../ui/chat/ChipRow.kt` (新) | 提取 |
| 2.3 | 提取 `ComposerField.kt` (TextField + Voice + Slash) | `android-app/.../ui/chat/ComposerField.kt` (新) | 提取 |
| 2.4 | 提取 `InputActionRow.kt` (Attach + Voice + Send/Cancel) | `android-app/.../ui/chat/InputActionRow.kt` (新) | 提取 |
| 2.5 | 重组 `ChatInputBar.kt` — 使用 `InputBarState` + 委托子组件，目标 ~150 行 | `android-app/.../ui/chat/ChatInputBar.kt` (重构) | 瘦身 |

**验证**:
- 所有输入功能不变 (文本/语音/附件/Slash 命令/Markdown 预览)
- `ChatInputBar.kt` 行数 ≤ 200

---

### P3: 审批层 — 类型化卡片 + DiffViewer + Auto-Reject (behind flag)

**目标**: 按审批类型分发布局；新增 DiffViewer 组件；Auto-Reject 默认关闭

**依赖**: P0.1 (ChatItem.ApprovalType), P3 内引入 `FeaturePrefs`

| # | 内容 | 产出文件 | 类型 |
|---|------|----------|------|
| 3.1 | 实现 `DiffViewer.kt` (Unified Inline Diff, 折叠/展开, 行着色) | `android-app/.../ui/component/DiffViewer.kt` (新) | 新建 |
| 3.2 | 重构 `ApprovalCard.kt` — 按 `ApprovalType` 分发布局 (EXEC/EDIT/MCP/GENERIC) | `android-app/.../ui/component/ApprovalCard.kt` (重构) | 重构 |
| 3.3 | 实现审批消失动画 (scale(0.97) + fadeOut(200ms)) | 同上 | 增强 |
| 3.4 | Auto-Reject 超时逻辑 (behind `FeaturePrefs.approvalAutoReject`, 默认关闭) | `android-app/.../ui/screen/ChatViewModel.kt` (增强) | 增强 |
| 3.5 | Auto-Reject 按风险等级分级: low=无超时, medium=60s, high=30s | 同上 | 增强 |
| 3.6 | Settings 页面添加 Auto-Reject 开关 + 超时配置 | `android-app/.../ui/screen/SettingsScreen.kt` (增强) | 增强 |

**Auto-Reject 策略 (不同于 v2.0 的硬编码 30s)**:

```kotlin
// 风险等级 → 超时策略 (FeaturePrefs.approvalAutoReject 为 true 时生效)
fun autoRejectTimeout(riskLevel: String): Long? = when (riskLevel.lowercase()) {
    "low", "safe" -> null         // 低风险不自动拒绝 — 保持连续性
    "medium"      -> 60_000L      // 中风险 60s
    "high"        -> 30_000L      // 高风险 30s (安全兜底)
    else          -> 60_000L
}
```

**验证**:
- DiffViewer: 传入 unified diff 字符串，验证行着色 (绿/红) + 折叠/展开
- ApprovalCard: 模拟 EXEC/EDIT/MCP 三种类型，验证差异化布局
- Auto-Reject: 默认关闭；手动开启后 high-risk 审批 30s 后自动拒绝

---

### P4: ??? ? Metrics ????

**??**: ?? Compose Metrics ?????????????????

**??**: P1 (key/contentType ???), P2+P3 ??

| # | ?? | ???? | ?? |
|---|------|----------|------|
| 4.1 | Compose Metrics / stability ???? | `android-app/app/build.gradle.kts` + `.ai/analysis/` | ?? |
| 4.2 | ?? `@Immutable`/`@Stable` ?? | `android-app/.../ui/model/ChatItem.kt` | ?? |
| 4.3 | ??????: ?????? + "? New" FAB | `android-app/.../ui/chat/ChatMessageList.kt` | ?? |
| 4.4 | ???? (100ms debounce) + ???? | `android-app/.../ui/screen/ChatViewModel.kt` | ?? |
| 4.5 | **???**: ????????????? ? ?? `StreamingMarkdown` ???? | `StreamingMarkdown.kt` (?, ??) | ?? |
| 4.6 | **???**: ??????? OOM / ???????? ? ?? `MessageRepository` LRU/?? | `MessageRepository.kt` (?, ??) | ?? |

**??**:
```bash
cd android-app && ./gradlew :app:testDebugUnitTest --tests "*TerminalPerformanceTest" --console=plain --info
```

**2026-03-09 ????**:
- `TerminalPerformanceTest` ?????/??/ANSI/??????????????
- ????????? `StreamingMarkdown` ????
- ????????? `MessageRepository` LRU/??
- ?? 4.5 / 4.6 ????????????

---

### P5: ????? ? ? Screen ????

**??**: ??????? session ????????

**??**: P0-P4 ????

| # | ?? | ???? | ?? |
|---|------|----------|------|
| 5.1 | ?? `SessionGateway` ?? ? ???? + session ?? | `android-app/.../data/SessionGateway.kt` (?) | ?? |
| 5.2 | ?? `DefaultSessionGateway` ? ? ChatViewModel ?? RelayClient/LocalRelayClient ?? | `android-app/.../data/DefaultSessionGateway.kt` (?) | ?? |
| 5.3 | `YuanioApp` ?? `SessionGateway` ?? | `android-app/.../YuanioApp.kt` (??) | ?? |
| 5.4 | `ChatViewModel` ???? `SessionGateway` | `android-app/.../ui/screen/ChatViewModel.kt` (??) | ?? |
| 5.5 | ?????? Hilt | ???? | ?? |

**??**:
- ChatViewModel ?? `SessionGateway` ???????????
- Terminal/Files ???????? (?? `YuanioApp.sessionGateway`)

**2026-03-09 ????**:
- `GlobalSessionManager` ?????? `SessionGateway` / `DefaultSessionGateway` ??
- `Hilt` ??????? `keep-out`???? `@HiltAndroidApp` / `@AndroidEntryPoint`
- ?????? DI???????????????????? `YuanioApp` ?????????? ADR

---

### P6: Terminal 增强 & 高阶交互

**目标**: SplitPane (behind flag) + 双图标迁移 + 手势系统

**依赖**: P5 (SessionGateway)

| # | 内容 | 产出文件 | 类型 |
|---|------|----------|------|
| 6.1 | 横屏 SplitPane (behind `FeaturePrefs.splitPaneTerminal`, 默认关闭) | `android-app/.../ui/component/SplitPaneLayout.kt` (新) | 新建 |
| 6.2 | MiniChatPane — 嵌入式精简 Chat 视图 | `android-app/.../ui/screen/MiniChatPane.kt` (新) | 新建 |
| 6.3 | Tabler Icons 全量迁移 (MainBottomBar, ApprovalCard, ThinkingBlock) | 多文件 | 迁移 |
| 6.4 | Lobe Icons 强制原彩色 (tint = Color.Unspecified) | `android-app/.../ui/component/BrandIcons.kt` | 增强 |
| 6.5 | 消息入场动画 (fadeIn + slideInVertically) | `android-app/.../ui/chat/ChatMessageList.kt` | 增强 |
| 6.6 | 长按菜单 (复制/重试/分享) | `android-app/.../ui/component/MessageContextMenu.kt` (新) | 新建 |

**验证**:
- SplitPane: 旋转到横屏 → 开启 flag → 验证左 Chat 右 Terminal
- Icons: 视觉走查确认 Tabler 线性 + Lobe 原彩色

---

## 10. Critical File Paths (仓库根相对路径)

### 现有文件 (需修改)

| 文件 | 当前行数 | 变更 | Phase |
|------|----------|------|-------|
| `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt` | 4098 | 提取事件解析 → P0; 提取连接 → P5 | P0, P5 |
| `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatMessageList.kt` | ~400 | key+contentType+流式分离 | P1 |
| `android-app/app/src/main/java/com/yuanio/app/ui/component/MarkdownText.kt` | ~200 | remember 缓存 | P1 |
| `android-app/app/src/main/java/com/yuanio/app/ui/chat/ChatInputBar.kt` | ~920 | 参数收敛+子组件拆分 | P2 |
| `android-app/app/src/main/java/com/yuanio/app/ui/component/ApprovalCard.kt` | 140 | 类型化分发 | P3 |
| `android-app/app/src/main/java/com/yuanio/app/ui/theme/Theme.kt` | 207 | Shapes+Surfaces Token | P1 |
| `android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt` | ~49 | FeaturePrefs.init | P3 |
| `android-app/app/src/main/java/com/yuanio/app/ui/screen/SettingsScreen.kt` | 1427 | Auto-Reject 开关 | P3 |
| `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt` | ~100 | Lobe 原彩色 | P6 |
| `android-app/app/src/main/java/com/yuanio/app/ui/component/MainBottomBar.kt` | 39 | Tabler Icons | P6 |
| `android-app/app/build.gradle.kts` | - | Compose metrics 配置 | P1 |

### 新建文件（分级）

#### 必须创建（开工即做）

| 文件 | 职责 | Phase |
|------|------|-------|
| `android-app/.../ui/model/ChatItem.kt` | 独立 sealed class + stableKey | P0 |
| `android-app/.../data/AgentEventParser.kt` | 纯函数式事件解析 | P0 |
| `android-app/.../test/.../AgentEventParserTest.kt` | fixture-first 解析契约测试 | P0 |
| `android-app/.../ui/chat/InputBarState.kt` | 输入栏状态数据类 | P2 |
| `android-app/.../ui/chat/ChipRow.kt` | Agent/Model/Permission 芯片行 | P2 |
| `android-app/.../ui/chat/ComposerField.kt` | 文本输入+语音+Slash | P2 |
| `android-app/.../ui/chat/InputActionRow.kt` | 附件+语音+发送按钮 | P2 |
| `android-app/.../ui/component/DiffViewer.kt` | Unified Inline Diff 查看器 | P3 |

#### 可延后（按阶段进入）

| 文件 | 职责 | Phase |
|------|------|-------|
| `android-app/.../data/FeaturePrefs.kt` | Feature Flag (SharedPreferences) | P3 |
| `stability_config.conf` | Compose stability 配置 | P4 |
| `android-app/.../data/SessionGateway.kt` | 连接管理接口 | P5 |
| `android-app/.../data/DefaultSessionGateway.kt` | 连接管理实现 | P5 |

#### P4+ 再评估（不要前置实现）

| 文件 | 职责 | Phase |
|------|------|-------|
| `android-app/.../ui/component/SplitPaneLayout.kt` | 横屏分屏布局 | P6 |
| `android-app/.../ui/screen/MiniChatPane.kt` | 嵌入式 Chat | P6 |
| `android-app/.../ui/component/MessageContextMenu.kt` | 长按菜单 | P6 |

### 共享协议层 (参考，本次不修改)

| 文件 | 关键内容 | 行号 |
|------|----------|------|
| `packages/shared/src/types.ts` | 60+ MessageType + Payload 接口 | L1-569 |
| `packages/shared/src/schemas.ts` | Zod 验证 schemas | L1-331 |
| `packages/shared/src/protocol.ts` | PROTOCOL_VERSION + 兼容检查 | L1-41 |
| `packages/cli/src/remote/dispatch.ts` | NormalizedEvent → MessageType 映射 | L1-132 |
| `packages/cli/src/adapters/` | Claude/Codex/Gemini 适配器 | - |

---

## Appendix A: Verification Checklist (可执行)

### A1. 自动化验证（必须）

#### 编译 & 构建

```bash
# 全量编译
cd android-app && ./gradlew assembleDebug

# Lint 检查
./gradlew lint

# 单元测试
./gradlew testDebugUnitTest
```

#### Compose Metrics

```bash
# 生成 Compose 编译器报告
./gradlew assembleRelease

# 检查 ChatItem Stability
grep -E "ChatItem|ChatUiState|InputBarState" \
  app/build/compose_metrics/app_release-classes.txt

# 检查 restartable/skippable 比率
grep "skippable" app/build/compose_metrics/app_release-composables.txt | wc -l
grep "restartable" app/build/compose_metrics/app_release-composables.txt | wc -l
```

#### 解析契约（P0 必须）

```bash
# 仅跑 AgentEventParser 契约测试（命名可按实际落地调整）
cd android-app && ./gradlew testDebugUnitTest --tests "*AgentEventParserTest"
```

### A2. 人工验证（按阶段执行）

#### 功能回归

| # | 场景 | 预期 | Phase |
|---|------|------|-------|
| 1 | 连接 Agent → 发送 prompt → 收到流式回复 | 流式渲染流畅，stream_end 后消息持久化 | P0 |
| 2 | Agent 执行工具调用 → 收到 tool_call 事件 | ToolCallCard 显示工具名+状态 | P0 |
| 3 | Agent 请求审批 → 批准/拒绝 | ApprovalCard 渲染 + 操作成功 | P0 |
| 4 | 发送 1000+ 字符长回复 | 流式渲染无明显 jank | P1 |
| 5 | 滚动 100+ 消息列表 | 滚动流畅（人工观察，无明显掉帧） | P1 |
| 6 | 输入文本/语音/附件/Slash 命令 | 所有输入功能正常 | P2 |
| 7 | EXEC 类型审批 (Bash 命令) | 显示命令预览 + monospace | P3 |
| 8 | EDIT 类型审批 (文件修改) | 内嵌 DiffViewer 预览 | P3 |
| 9 | Auto-Reject 开启 + high-risk 审批 | 30s 后自动拒绝 + 通知 | P3 |
| 10 | 1000 条消息 + 滚动 | 无 OOM，内存 < 150MB（以工具采样为准） | P4 |

### AgentEventParser 单元测试矩阵

| 测试 | 输入 | 预期输出 |
|------|------|----------|
| Claude thinking | §7.1 fixture #1 | `ParsedEvent.ThinkingUpdate` with turnId="turn_1" |
| Claude tool_call running | §7.1 fixture #2 | `ParsedEvent.ToolCallUpdate` with status=RUNNING |
| Claude tool_call done | §7.1 fixture #3 | `ParsedEvent.ToolCallUpdate` with status=SUCCESS |
| Claude approval | §7.1 fixture #4 | `ParsedEvent.ApprovalReceived` with type=EDIT |
| Claude file_diff | §7.1 fixture #5 | `ParsedEvent.FileDiffReceived` with action="modified" |
| Claude stream | §7.1 fixture #6 | `ParsedEvent.StreamChunk` with text |
| Claude usage | §7.1 fixture #8 | `ParsedEvent.UsageUpdate` with cumulative tokens |
| Codex thinking | §7.2 fixture #1 | `ParsedEvent.ThinkingUpdate` with agent="codex" |
| Codex approval | §7.2 fixture #2 | `ParsedEvent.ApprovalReceived` with type=EXEC |
| Gemini tool_call | §7.3 fixture #1 | `ParsedEvent.ToolCallUpdate` with agent="gemini" |
| Unknown type | `{"type":"future_type"}` | `null` (graceful skip) |
| Malformed JSON | `{"type":"thinking","payload":"not json"}` | Error handling, no crash |

---

## Appendix B: Architecture Decision Records

### ADR-1: ?? P0 ?? Hilt

**???**: ?? v2.0 ? Phase 0 ???? GlobalSessionManager + Hilt + FeatureFlags DSL + MessageRepository + StreamingMarkdown

**??**: ?? Hilt ? P5????? + YuanioApp ????

**??**:
1. ???? 10 ? Prefs singleton ???????????
2. Hilt ???? gradle ?????@HiltAndroidApp?@AndroidEntryPoint ???????
3. P0 ??????"??????"?? DI ????

**2026-03-09 ??**:
- P5 ??? `SessionGateway`???????????????? Hilt
- ? ADR ????????????? `keep-out`

### ADR-2: ToolCallStatus 保留 4 种而非 7 种

**上下文**: 蓝图 v2.0 定义了 VALIDATING, SCHEDULED, EXECUTING, SUCCESS, ERROR, CANCELLED, AWAITING_APPROVAL

**决策**: 保留 RUNNING, SUCCESS, ERROR, AWAITING_APPROVAL

**理由**:
1. CLI dispatch.ts 实际只发 running/done/error 三种 status
2. Gemini 的 VALIDATING/SCHEDULED/CANCELLED 在 Yuanio adapter 层已被归一化为 running/done/error
3. YAGNI – 不为当前协议不传输的状态创建 UI
4. 若未来协议要增加状态，必须先修改 `packages/shared` / `packages/cli/src/remote/dispatch.ts`，Android 只跟随共享契约演进，不能先行发明状态

### ADR-3: Auto-Reject 默认关闭 + 风险分级

**上下文**: 蓝图 v2.0 硬编码 30s 全局 Auto-Reject

**决策**: 默认关闭；开启后按风险等级分级 (low=无, medium=60s, high=30s)

**理由**:
1. HAPI/Happy 的核心价值是"离开桌面还能继续会话"；Auto-Reject 与此矛盾
2. 低风险审批自动拒绝会打断连续性
3. 作为安全兜底功能，应由用户显式开启

### ADR-4: Markdown ????????

**???**: ?? v2.0 ???? StreamingMarkdown ??????

**??**: P1 ?? remember ?? + ?????? item?P4 ?? Compose Metrics ????????

**??**:
1. `remember(content) { splitCodeBlocks(content) }` ???? < 10 ????????????????
2. ?????? `item(key="streaming")` ????????
3. ??????? ~300 ???????? profiling ????

**2026-03-09 ??**:
- `TerminalPerformanceTest --info` ??????????? `StreamingMarkdown`
- `MessageRepository` LRU/?????????????????

### ADR-5: 路径使用仓库根相对路径

**上下文**: 蓝图 v2.0 使用 `ui/...` 裸路径

**决策**: 全部使用 `android-app/app/src/main/java/com/yuanio/app/...` 或 `packages/shared/src/...` 完整路径

**理由**: 本项目是 monorepo，裸路径歧义

---

*End of Blueprint v2.1*

# Android 多语言硬编码治理方案

## 1. 现状与问题

### 1.1 现状证据
- 已有资源目录：`android-app/app/src/main/res/values`、`android-app/app/src/main/res/values-en`。
- `strings.xml` 键数量：中英文各 `92` 个，键集合一致。
- Kotlin 源码仍存在大量写死文案（基于正则扫描）：
  - 含中文字符串字面量约 `878` 处（粗略）。
  - `Text("...")` 形式约 `239` 处。
  - `contentDescription = "..."` 约 `53` 处。
  - `_toast.value = "..."` 约 `119` 处。
  - `Toast.makeText(..., "...")` 约 `9` 处。
- 高优先级集中文件（匹配量 Top）：
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/SettingsScreen.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/FileManagerScreen.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/TerminalScreen.kt`
  - `android-app/app/src/main/java/com/yuanio/app/ui/screen/SessionListScreen.kt`

### 1.2 问题本质
- 文案来源分裂：一部分来自 `R.string`，一部分直接写死在 Compose / ViewModel / Service。
- ViewModel 层直接产出用户可见文本，导致翻译无法集中管理。
- 缺少“新增硬编码阻断门禁”，导致问题持续回流。

## 2. 目标与边界

### 2.1 目标
- 用户可见文案统一进入 `strings.xml`（含 `plurals` / 格式化占位）。
- App 在系统语言切换后，UI 文案与提示一致切换。
- 建立 CI 门禁，阻止新增硬编码文案。
- 文案用词满足“人类常用、行业共识、约定成俗、无歧义、通俗易懂”。

### 2.2 非目标
- 不改协议字段、日志键、RPC method、callback 数据等“机器字段”。
- 不做一次性全量重写，采用可回归的分批迁移。

## 3. 目标架构

### 3.0 文案词汇规范（新增）
- 人类常用：优先使用普通用户日常理解的词，不用生僻词、内部黑话。
- 业界共识：优先采用常见产品术语（如“保存/删除/重试/取消”）。
- 约定成俗：同一动作在全 App 保持同一叫法，不出现“提交/发送/推送”混用。
- 无歧义：避免模糊词（如“处理一下”），明确动作对象与结果（如“删除文件”）。
- 通俗易懂：句子短、信息直达，避免长句和嵌套修饰。
- 禁止项：
  - 禁止炫技词、拟人化夸张词、内部代号直接暴露给用户。
  - 禁止同一界面中英混杂（除品牌名/命令名）。
- 动态文案规范：
  - 使用格式化占位符表达变量，不在代码里拼自然语言。
  - 优先模板句式：`动作 + 对象 + 结果`（例：`已回滚: %1$s`）。

### 3.1 资源层
- 所有用户可见文案统一放入：
  - `android-app/app/src/main/res/values/strings.xml`
  - `android-app/app/src/main/res/values-en/strings.xml`
- 命名规范：
  - 页面：`chat_*`、`settings_*`、`files_*`、`terminal_*`
  - 操作：`action_*`
  - 提示：`toast_*`、`error_*`
- 动态文案统一使用占位符：`%1$s`、`%1$d`。

### 3.2 ViewModel 文案解耦（关键）
- 禁止 ViewModel 直接拼接中文/英文字符串。
- 引入 `UiText`（或 `UiMessage`）模型承载资源 ID 与参数。

```kotlin
sealed interface UiText {
    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList()) : UiText
    data class Raw(val value: String) : UiText // 仅调试或后端透传兜底
}
```

- `ChatViewModel` 的 `_toast: StateFlow<String?>` 改为 `_toast: StateFlow<UiText?>`。
- UI 层统一解析：
  - Compose：`stringResource(id, *args)`
  - 非 Compose：`context.getString(id, *args)`

### 3.3 Compose 约束
- 所有 `Text("...")`、`contentDescription = "..."` 改为资源调用。
- 规则示例：
  - `Text(stringResource(R.string.chat_action_continue))`
  - `contentDescription = stringResource(R.string.cd_open_timeline)`

### 3.4 Service / Notification / Toast 约束
- `ShortcutActivity`、`FCMService`、`Notifier`、`TerminalForegroundService` 的可见文案全部走 `R.string`。
- 通知 action label 也走资源，不允许 `"批准" / "Reject"` 直接写死。

## 4. 分阶段执行（严格 DAG）

### Phase 0：基线建立
- 输出硬编码清单（文件、行号、分类）。
- 在 `docs/` 维护迁移看板（完成率与剩余量）。

### Phase 1：基础设施
- 增加 `UiText` 及解析工具。
- 为 `ChatViewModel`、`SettingsScreen` 准备字符串 key（不改业务逻辑）。

### Phase 2：核心链路迁移（P0）
- 先迁移高频交互链路：
  - `ChatViewModel.kt`
  - `ChatScreen.kt`
  - `ChatInputBar.kt`
  - `ChatTopBar.kt`
  - `ApprovalCard.kt`
- 目标：聊天主流程无硬编码用户文案。

### Phase 3：设置与文件域迁移（P1）
- 迁移：
  - `SettingsScreen.kt`
  - `FileManagerScreen.kt`
  - `TerminalScreen.kt`
  - `SessionListScreen.kt`
  - `SkillsScreen.kt`

### Phase 4：服务层与收口（P1）
- 迁移：
  - `ShortcutActivity.kt`
  - `FCMService.kt`
  - `Notifier.kt`
  - `TerminalForegroundService.kt`
- 清理 `Raw` 文案兜底，仅保留必要后端透传。

### Phase 5：门禁与防回流（P0）
- 新增脚本扫描并接入 CI，阻断新增硬编码：
  - `Text("...")`
  - `contentDescription = "..."`
  - `_toast.value = "..."`
  - `Toast.makeText(..., "...")`
- 使用 baseline 机制逐步收敛，不阻断历史存量一次性清零。

## 5. 测试策略

### 5.1 单元测试
- `UiText` 解析测试（参数替换、fallback）。
- ViewModel 发出的 toast 消息类型测试（Res/Raw）。

### 5.2 UI 测试
- 关键页面在中英文切换下的可见文本断言：
  - Chat、Settings、FileManager。

### 5.3 回归测试
- 已有 `connectedDebugAndroidTest` 与 `testDebugUnitTest` 持续执行。
- 增加一条“资源完整性检查”：
  - `values` 与 `values-en` 键集一致性校验。

## 6. 验收标准
- `android-app/app/src/main/java` 内新增代码不允许出现新的硬编码用户文案。
- `Text("...")`、`contentDescription = "..."`、`_toast.value = "..."` 新增违规数为 `0`。
- 中英文切换后，主路径页面文案一致切换，通知标题与按钮文案可切换。
- 文案抽检通过：
  - 抽检范围：Chat / Settings / Files / Notifications 四个域。
  - 通过条件：满足“人类常用、共识术语、无歧义、通俗易懂”，且同义动作命名一致。

## 7. 风险与应对
- 风险：一次性替换过大导致回归风险高。
  - 应对：按页面分批，单 PR 不跨域。
- 风险：ViewModel 改 `String -> UiText` 影响面广。
  - 应对：先在 `ChatViewModel` 试点，稳定后复制到其他 ViewModel。
- 风险：动态拼接文本遗漏占位符。
  - 应对：所有动态文案必须通过 `R.string` + format 参数表达。

## 8. 推荐实施顺序（本项目）
1. `ChatViewModel.kt`（toast 与状态提示，最高收益）
2. `ChatScreen.kt` / `ChatInputBar.kt` / `ChatTopBar.kt`
3. `SettingsScreen.kt`
4. `FileManagerScreen.kt` / `TerminalScreen.kt`
5. Service/Notification 层收尾 + CI 门禁

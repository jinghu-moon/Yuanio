# Yuanio 终端重构计划：WebView → ConnectBot termlib 原生渲染

## 1. 核心决策摘要

1.  **目标优先级固定**：`高性能 > 低占用 > 高速度 > 交互完整`，并满足“手机端直接操作电脑端终端（输入/执行/回显）”。
2.  **技术选型固定**：当前主线采用 **ConnectBot termlib + 现有 Relay/PTY** 单引擎。
    *   *理由*：`libvterm` (C) + Compose 原生渲染，路径最短、性能最好、实现最快。
    *   *不做双引擎*：开发期保持单栈，降低复杂度与维护成本（YAGNI）。
3.  **破坏性改动策略**：一次性移除 `WebView + xterm.js` 旧栈，不做双栈兼容开关。
4.  **版本策略**：钉死 **0.0.18**（Maven 依赖），不预先 fork。
    *   *理由*：ConnectBot 在 2026-02-22 将 termlib [从 0.0.22 回退到 0.0.18](https://github.com/connectbot/connectbot/releases/tag/git-v1.9.13-409-g3e0f62d1)，[当前 main 分支使用 0.0.18](https://github.com/connectbot/connectbot/blob/main/gradle/libs.versions.toml)。
    *   *Fork 时机*：仅在确实需要改 termlib 内部行为（如 scrollback）时 fork。
5.  **数据管线策略**：Phase 2 维持 `String` 传递，预留 `ByteArray` 重载；`ByteArray 全链路 + seq/replay` 放到 Phase 5（跨栈改造）。
6.  **背压策略**：Phase 2 使用 `Channel(8192) + DROP_OLDEST + trySend()`。
    *   *理由*：不阻塞 Socket 事件线程，避免 `SUSPEND` 导致心跳中断。
    *   *边界*：极端洪流下允许丢弃最旧、不可见历史行；保证可交互性优先。
7.  **封装策略**：保留薄封装层 **TerminalEmulatorManager**（具体类，非接口），专门处理输入死锁规避、resize 桥接、主题映射、搜索输入源。
8.  **实施路径**：Phase 1-4 为纯客户端可独立交付；Phase 5 做输出完整性增强（跨栈）；Phase 6 做 `SSH + tmux` 架构升级；`mosh` 不纳入当前计划。
9.  **ABI 锁定**：仅保留 `arm64-v8a`，加速构建、缩小包体、加快安装。

---

## 2. 背景

### 当前痛点
当前终端实现基于 `xterm.js + WebView + WebMessagePort` 桥接，存在以下问题：
*   **内存开销大**：每个 Tab 约 35MB（WebView 进程开销）。
*   **APK 体积臃肿**：包含 ~764KB JS 资产（xterm 478K + webgl 243K + terminal.html + css）。
*   **键盘 Bug**：Android WebView IME 缓冲导致 `onData` 需按两次 Enter 才能生效。
*   **启动延迟**：即使有 WebViewPool 预热，仍需约 50ms/tab。
*   **通信开销**：WebMessagePort 序列化增加了每帧的延迟。

### 重构目标
替换为 **ConnectBot termlib**（libvterm C 引擎 + Compose Canvas 渲染），实现：
*   **内存优化**：降至 ~2-3MB/Tab（降低 90%+）。
*   **体积优化**：移除所有 JS 资产（净增约 ~1MB，仅 arm64 .so）。
*   **输入修复**：原生键盘处理，彻底消除 IME Bug。
*   **极速启动**：Tab 创建时间 <5ms。
*   **低延迟**：直接 Canvas 渲染，零桥接延迟。
*   **会话恢复**：App 回前台自动重连并恢复会话；网络抖动场景不中断长任务。

---

## 3. 技术选型：ConnectBot termlib

*   **Maven**: `org.connectbot:termlib:0.0.18`（ConnectBot 生产验证版本）
*   **许可证**: Apache 2.0 + MIT (libvterm)
*   **底层引擎**: `libvterm` (C) via JNI — 与 neovim 同款 VT 引擎。
*   **Composable**: `Terminal(terminalEmulator, modifier, typeface, initialFontSize, minFontSize, maxFontSize, backgroundColor, foregroundColor, keyboardEnabled, forcedSize, ...)`
*   **输入 API**: `TerminalEmulatorFactory.create(onKeyboardInput = { ... }, onResize = { dims -> ... })`
*   **输出 API**: `emulator.writeInput(data: ByteArray)` / `emulator.writeInput(buffer: ByteBuffer, length)`
*   **回调 API**: `onResize(TerminalDimensions)` — 终端尺寸变化时自动回调，无需轮询。
*   **颜色 API**: `emulator.applyColorScheme(ansiColors: IntArray, defaultForeground: Int, defaultBackground: Int)` — 16 色 ANSI 调色板 + default fg/bg。
*   **特性支持**: 256色/TrueColor、CJK 宽字符、触摸选区、捏合缩放、回滚滚动。
*   **缺失功能**: 搜索、粘贴（需自行补充）。
*   **已知限制**: 回滚行数内部固定 1000 行，不可配置（libvterm 自身不管理 scrollback，是 termlib JNI 层的实现限制；fork 后可通过修改 `sb_pushline` 回调逻辑解除）。
*   **ABI**: armeabi-v7a, arm64-v8a, x86, x86_64（本项目仅保留 arm64-v8a）。

### 版本选择依据

| 版本 | 状态 | 说明 |
|------|------|------|
| 0.0.22 | ⚠️ 已被回退 | ConnectBot main 分支 [2026-02-22 回退](https://github.com/connectbot/connectbot/releases/tag/git-v1.9.13-409-g3e0f62d1)，原因未公开 |
| **0.0.18** | ✅ 生产使用 | ConnectBot [当前 main 分支依赖](https://github.com/connectbot/connectbot/blob/main/gradle/libs.versions.toml) |

### 体积现实数据

| 资产 | 大小 |
|------|------|
| 现有 xterm 资产总计 | ~764KB |
| termlib-0.0.18.aar（全 ABI） | ~3.7MB |
| termlib arm64-v8a 单 ABI | ~1MB（估） |
| **净增量（锁 arm64）** | **~+250KB** |

---

## 4. 文件变更总览

### 删除文件（5 个）
| 文件                                   | 原因                     |
| :------------------------------------- | :----------------------- |
| `ui/component/XtermWebView.kt` (115行) | WebView 桥接层，完全废弃 |
| `assets/terminal.html` (219行)         | xterm.js 前端，完全废弃  |
| `assets/xterm/xterm.min.js` (478KB)    | JS 库                    |
| `assets/xterm/addon-*.min.js` (243KB+) | JS 插件                  |
| `assets/xterm/xterm.min.css`           | CSS 样式                 |

### 新建文件（3 个）
| 文件                                     | 用途                                                                | 预估行数 |
| :--------------------------------------- | :------------------------------------------------------------------ | :------- |
| `ui/terminal/TerminalEmulatorManager.kt` | termlib 薄封装：创建/管理 TerminalEmulator 实例，统一搜索、主题映射 | ~180     |
| `ui/terminal/TerminalSearchHelper.kt`    | 基于 PTY 输出流的搜索实现（termlib 不内置搜索）                     | ~120     |
| `service/TerminalForegroundService.kt`   | 前台服务：会话期间保活连接、托管通知与 WakeLock                     | ~120     |

### 修改文件（5 个）
| 文件                                     | 变更内容                                                                      |
| :--------------------------------------- | :---------------------------------------------------------------------------- |
| `ui/screen/TerminalScreen.kt` (977行)    | 大幅重构：删除所有 WebView/xterm 相关代码，改用 `Terminal()` composable       |
| `ui/screen/TerminalViewModel.kt` (299行) | 最小改动：输出背压 `SharedFlow(128)` → `Channel(8192) + DROP_OLDEST`          |
| `app/build.gradle.kts`                   | 添加 termlib 依赖，ABI 锁定 arm64-v8a                                        |
| `YuanioApp.kt`                         | 删除 WebViewPool 对象及其 prewarm() 调用，清理 WebView 调试开关               |
| `AndroidManifest.xml`                    | 注册 `TerminalForegroundService`、补充前台服务权限声明                        |

### 不需要修改的文件
| 文件                           | 原因                                          |
| :----------------------------- | :-------------------------------------------- |
| `TerminalPrefs.kt` (513行)     | 持久化层不涉及渲染                            |
| `TerminalView.kt` (46行)       | 聊天内嵌终端输出组件，与 xterm 无关           |
| `RelayClient.kt`               | Phase 2-4 不改协议层                          |
| `EnvelopeHelper.kt`            | Phase 2-4 保持 String 解密主路径              |

---

## 5. 实施计划

### Phase 1: 依赖与清理

#### 1.1 添加 termlib 依赖 + ABI 锁定
**文件**: `android-app/app/build.gradle.kts`

```kotlin
// 依赖（钉死 0.0.18，ConnectBot 生产验证版本）
implementation("org.connectbot:termlib:0.0.18")
```

```kotlin
// ABI 锁定：仅 arm64-v8a（加速构建 + 缩小包体 + 加快安装）
splits {
    abi {
        isEnable = !isBundleBuild
        if (!isBundleBuild) {
            reset()
            include("arm64-v8a")
            isUniversalApk = false
        }
    }
}
```

#### 1.2 删除 WebView 相关代码
*   删除 `XtermWebView.kt`。
*   删除 `assets/terminal.html`。
*   删除 `assets/xterm/` 整个目录。
*   从 `YuanioApp.kt` 中删除 `WebViewPool` object 及 `prewarm()` 调用。
*   若项目无其他 WebView 使用点，删除 `WebView.setWebContentsDebuggingEnabled(...)`。

---

### Phase 2: 核心集成

#### 2.1 TerminalViewModel 背压修复（最小改动）

**问题**：当前 `_outputs` 使用 `MutableSharedFlow<TerminalOutput>(extraBufferCapacity = 128)` + `tryEmit()`。高吞吐（如大文件输出）时会静默丢数据。

**修复方案**：替换为 `Channel(8192) + BufferOverflow.DROP_OLDEST`，发射端使用 `trySend()`。

```kotlin
// 旧
private val _outputs = MutableSharedFlow<TerminalOutput>(extraBufferCapacity = 128)
val outputs = _outputs.asSharedFlow()

// 新
private val _outputChannel = Channel<TerminalOutput>(
    capacity = 8192,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
)
val outputs: Flow<TerminalOutput> = _outputChannel.receiveAsFlow()
```

```kotlin
// 旧
_outputs.tryEmit(TerminalOutput(ptyId, data))

// 新
_outputChannel.trySend(TerminalOutput(ptyId, data))
```

> 说明：
> 1. 不使用 `SUSPEND`，避免阻塞 Socket.IO 事件线程导致心跳中断。
> 2. 不在 Phase 2 引入 `seq/replay` 协议改造，保持纯客户端可独立交付。
> 3. `ByteArray 全链路 + seq/replay` 放入 Phase 5 单独实施。

#### 2.2 TerminalEmulatorManager.kt

**文件**: `ui/terminal/TerminalEmulatorManager.kt`

封装 termlib 的 `TerminalEmulator`，解决以下问题：
*   **死锁防护**：`onKeyboardInput` 回调中不能调用 emulator 方法，需 dispatch 到协程。
*   **resize 通知**：利用 termlib 原生 `onResize` 回调直接通知远程 PTY（无轮询）。
*   **主题映射**：通过 `applyColorScheme()` 设置完整 16 色 ANSI 调色板 + fg/bg。
*   **输出桥接**：将 `TerminalViewModel.outputs` 连接到 `emulator.writeInput()`。

> **不引入 TerminalEngine 接口**：只有 termlib 一个实现，接口 = YAGNI。Manager 已是薄封装层，未来需要第二引擎时 Extract Interface 即可。

```kotlin
class TerminalEmulatorManager(
    val ptyId: String,
    initialRows: Int = 24,
    initialCols: Int = 80,
    colorScheme: TerminalColorScheme,
    onInput: (ByteArray) -> Unit,                    // → vm.sendInput(id, String(bytes, UTF_8))
    onResize: (cols: Int, rows: Int) -> Unit,        // → vm.sendResize()
) {
    val emulator: TerminalEmulator = TerminalEmulatorFactory.create(
        initialRows = initialRows,
        initialCols = initialCols,
        defaultForeground = colorScheme.foreground,
        defaultBackground = colorScheme.background,
        onKeyboardInput = { data: ByteArray ->
            // 严禁在此回调中调用 emulator 任何方法（会死锁）
            // 必须异步 dispatch
            inputChannel.trySend(data)
        },
        onResize = { dims ->
            // termlib 原生回调：布局尺寸变化时自动触发
            // 直接通知远程 PTY 调整窗口大小
            onResize(dims.columns, dims.rows)
        }
    )

    init {
        // 应用完整 16 色 ANSI 调色板（确保 ls --color、vim 等颜色正确）
        emulator.applyColorScheme(
            colorScheme.ansiColors,
            colorScheme.foreground.toArgb(),
            colorScheme.background.toArgb(),
        )
    }

    // 输入协程：避免 onKeyboardInput 死锁
    private val inputChannel = Channel<ByteArray>(Channel.BUFFERED)
    fun collectInput(scope: CoroutineScope) {
        scope.launch {
            for (data in inputChannel) { onInput(data) }
        }
    }

    // 当前主路径：Relay 层输出为 String
    fun writeOutput(data: String) {
        emulator.writeInput(data.toByteArray(Charsets.UTF_8))
    }
    // 预留：Phase 5 ByteArray 全链路切换后可直接调用
    fun writeOutput(data: ByteArray) {
        emulator.writeInput(data)
    }

    fun destroy() { /* 清理资源 */ }
}
```

**TerminalColorScheme 数据类**（放在同文件底部或单独文件）：

```kotlin
data class TerminalColorScheme(
    val foreground: Color,
    val background: Color,
    val ansiColors: IntArray,  // 16 色 ANSI 调色板（黑/红/绿/黄/蓝/品/青/白 × 普通/亮色）
) {
    companion object {
        /** Windows Terminal "One Half Dark" 风格 */
        val DARK = TerminalColorScheme(
            foreground = Color(0xFFDCDFE4),
            background = Color(0xFF282C34),
            ansiColors = intArrayOf(
                0xFF282C34.toInt(), 0xFFE06C75.toInt(), 0xFF98C379.toInt(), 0xFFE5C07B.toInt(),
                0xFF61AFEF.toInt(), 0xFFC678DD.toInt(), 0xFF56B6C2.toInt(), 0xFFDCDFE4.toInt(),
                // bright
                0xFF5C6370.toInt(), 0xFFE06C75.toInt(), 0xFF98C379.toInt(), 0xFFE5C07B.toInt(),
                0xFF61AFEF.toInt(), 0xFFC678DD.toInt(), 0xFF56B6C2.toInt(), 0xFFFFFFFF.toInt(),
            )
        )
        /** Windows Terminal Light */
        val LIGHT = TerminalColorScheme(
            foreground = Color(0xFF383A42),
            background = Color(0xFFFAFAFA),
            ansiColors = intArrayOf(
                0xFF383A42.toInt(), 0xFFE45649.toInt(), 0xFF50A14F.toInt(), 0xFFC18401.toInt(),
                0xFF4078F2.toInt(), 0xFFA626A4.toInt(), 0xFF0184BC.toInt(), 0xFFA0A1A7.toInt(),
                // bright
                0xFF696C77.toInt(), 0xFFE45649.toInt(), 0xFF50A14F.toInt(), 0xFFC18401.toInt(),
                0xFF4078F2.toInt(), 0xFFA626A4.toInt(), 0xFF0184BC.toInt(), 0xFFFFFFFF.toInt(),
            )
        )
        /** PowerShell Classic Blue（预设，仅调试用，不进入 TerminalPrefs 持久化枚举） */
        val POWERSHELL = TerminalColorScheme(
            foreground = Color(0xFFCCCCCC),
            background = Color(0xFF012456),
            ansiColors = intArrayOf(
                0xFF000000.toInt(), 0xFF800000.toInt(), 0xFF008000.toInt(), 0xFF808000.toInt(),
                0xFF000080.toInt(), 0xFF800080.toInt(), 0xFF008080.toInt(), 0xFFC0C0C0.toInt(),
                // bright
                0xFF808080.toInt(), 0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFFFFFF00.toInt(),
                0xFF0000FF.toInt(), 0xFFFF00FF.toInt(), 0xFF00FFFF.toInt(), 0xFFFFFFFF.toInt(),
            )
        )
    }
}
```

#### 2.3 TerminalScreen.kt 核心重构

**删除的状态/映射**：
```kotlin
// 删除以下状态
val xtermMap = remember { mutableStateMapOf<String, XtermWebView?>() }
val webViewMap = remember { mutableStateMapOf<String, WebView?>() }
val readyMap = remember { mutableStateMapOf<String, Boolean>() }
val pendingMap = remember { mutableStateMapOf<String, ArrayDeque<String>>() }

// 新增状态
val emulatorMap = remember { mutableStateMapOf<String, TerminalEmulatorManager>() }
val sizeMap = remember { mutableStateMapOf<String, Pair<Int, Int>>() }  // 保留：用于重连/切换 Profile
```
> `readyMap/pendingMap` 不再需要：termlib 无异步初始化，创建即可用。

**输出流收集简化**：
```kotlin
vm.outputs.collect { output ->
    emulatorMap[output.ptyId]?.writeOutput(output.data)
}
```

**WebView 容器替换**：
```kotlin
// 删除 AndroidView(...) 及 WebView 初始化逻辑

// 新增 Terminal Composable
if (isActive) {
    val mgr = emulatorMap[tab.id]
    if (mgr != null) {
        Terminal(
            terminalEmulator = mgr.emulator,
            modifier = Modifier.fillMaxSize(),
            typeface = Typeface.MONOSPACE,
            initialFontSize = prefs.fontSize.sp,
            minFontSize = 8.sp,
            maxFontSize = 32.sp,
            backgroundColor = colorScheme.background,
            foregroundColor = colorScheme.foreground,
            keyboardEnabled = true,
            showSoftKeyboard = true,
        )
    }
}
```
> 非活跃 Tab 不创建 `Terminal()` 是设计行为：emulator 在 `emulatorMap` 内持续接收输出并维护屏幕缓冲，切回时会直接渲染当前状态。

> **resize 不需要额外处理**：termlib 在布局尺寸变化时自动重算 rows/cols 并触发 `onResize` 回调，Manager 中已直接桥接到 `vm.sendResize()`。

**Tab 创建流程**：
```kotlin
fun addTab(profileId: String) {
    val tab = TerminalTab(id = uuid(), profileId = profileId, ...)
    tabs.add(tab)
    val scheme = resolveColorScheme(prefs.theme)
    val mgr = TerminalEmulatorManager(
        ptyId = tab.id,
        colorScheme = scheme,
        onInput = { data -> vm.sendInput(tab.id, String(data, Charsets.UTF_8)) },
        onResize = { cols, rows ->
            sizeMap[tab.id] = cols to rows
            vm.connect(tab.id, cols, rows, profile.shell, profile.cwd)
        }
    )
    mgr.collectInput(scope)
    emulatorMap[tab.id] = mgr
    activeId = tab.id
}
```

**Tab 关闭流程**：
```kotlin
fun closeTab(id: String) {
    emulatorMap[id]?.destroy()
    emulatorMap.remove(id)
    vm.kill(id)
    tabs.removeAll { it.id == id }
}
```

**生命周期简化**：
```kotlin
// 删除 ON_RESUME / ON_PAUSE 的 WebView 生命周期调用
// onDispose 仅需：
emulatorMap.values.forEach { it.destroy() }
```
> termlib 无需 pause/resume 生命周期管理。

#### 2.4 配置应用方式变更

*   **字体大小**：直接使用 `Terminal()` 的 `initialFontSize`、`minFontSize`、`maxFontSize` 参数。支持捏合缩放（由 termlib 内部处理）。如需固定大小禁止缩放，设 `minFontSize == maxFontSize == initialFontSize`。
*   **主题切换**：通过 `applyColorScheme(ansiColors, defaultForeground, defaultBackground)` 设置完整 16 色调色板 + default fg/bg。确保 `ls --color`、vim/nvim、htop 等颜色正确。
*   **回滚行数**：termlib 内部固定 `maxScrollbackLines = 1000`，**当前不可配置**。libvterm 自身通过 `sb_pushline/sb_popline` 回调将 scrollback 委托给 embedder，限制来自 termlib JNI 层。如需调整需 fork termlib 修改回调逻辑。UI 上暂时隐藏回滚行数设置项。
*   **动态生效风险（必测）**：`initialFontSize`/`applyColorScheme` 对已存在终端实例是否实时生效需在 Phase 2 验证；若不生效，采用 `destroy + recreate emulator` 兜底。
*   **主题枚举一致性**：`TerminalPrefs.TerminalTheme` 当前仅 `DARK/LIGHT`，Phase 2 不扩展持久化枚举；`POWERSHELL` 仅保留调试预设，不对用户暴露。

---

### Phase 3: 缺失功能补充

#### 3.1 搜索功能 — TerminalSearchHelper.kt
**文件**: `ui/terminal/TerminalSearchHelper.kt`

维护一个并行文本缓冲区，从 PTY 输出流中提取纯文本进行搜索。

```kotlin
class TerminalSearchHelper {
    // 环形缓冲：保留最近 N 行纯文本（去除 ANSI 转义序列后）
    private val buffer = ArrayDeque<String>(MAX_LINES)

    fun append(data: String) {
        val clean = stripAnsi(data)
        clean.lines().forEach { line ->
            buffer.addLast(line)
            if (buffer.size > MAX_LINES) buffer.removeFirst()
        }
    }

    fun search(query: String): List<SearchMatch> { ... }
    fun findNext(query: String): SearchMatch? { ... }
    fun findPrev(query: String): SearchMatch? { ... }

    companion object {
        private const val MAX_LINES = 5000
        private val ANSI_REGEX = Regex("\u001B\\[[0-9;]*[a-zA-Z]")
        fun stripAnsi(text: String) = text.replace(ANSI_REGEX, "")
    }
}
```

> **搜索结果展示**：先做"结果列表 + 跳转"（类似 VS Code 搜索结果面板），暂缓 Overlay 高亮。高亮定位在终端网格里成本高且易错，先满足可用性，后续再增强。

#### 3.2 粘贴功能
termlib 不内置粘贴，直接将剪贴板文本作为 PTY 输入发送：
```kotlin
fun paste(text: String) {
    vm.sendInput(activeTabId, text)
}
```

#### 3.3 清屏与重置（保留现有菜单能力）
termlib 无公开 `clear()/reset()` API，改为发送 ANSI 控制序列：

```kotlin
fun clearScreen(id: String) {
    vm.sendInput(id, "\u001B[2J\u001B[H") // Erase Display + Cursor Home
}

fun resetTerminal(id: String) {
    vm.sendInput(id, "\u001Bc") // RIS: Reset to Initial State
}
```

#### 3.4 复制选中能力（必确认项）
termlib 支持选区交互，但需在实施时确认是否有稳定 API 读取选中文本（例如 `getSelectedText()` 或等价回调）。

*   若有 API：复用当前“选中后写入剪贴板”流程。
*   若无 API：在 `TerminalEmulatorManager` 增加选区文本管理层，避免功能回退。

#### 3.5 ACK 移除说明
旧架构存在 `onAck -> vm.sendAck(...)` 流程。迁移到 termlib 后无 ACK 回调，应显式移除该链路并验证服务端在无 ACK 时不会阻塞或降速异常。

---

### Phase 4: 会话恢复与后台稳定性（必做）

#### 4.1 前后台恢复
1. App `onStart` 自动检查 Relay 连接与 PTY 会话状态。
2. 若断开：自动重连 Relay，并按 `ptyId` 逐个 reattach。
3. 回到前台后恢复当前激活 Tab 的输入焦点与键盘状态。

#### 4.2 后台存活能力（Android）
1. 新增 `TerminalForegroundService`（常驻通知，终端会话期间开启）。
2. 按需申请 `PARTIAL_WAKE_LOCK`（仅会话活跃时持有）。
3. 心跳与重连退避参数下沉到配置：`heartbeatIntervalMs`、`reconnectBackoffMs`。
4. 在 `AndroidManifest.xml` 中注册 Service 与前台服务类型，避免运行时启动失败。

#### 4.3 视觉项处理
Tab 栏视觉升级不进入本轮性能主线，后置为独立 UI 迭代（不影响 Phase 1-4 交付）。

---

## 6. 实施顺序

```
Phase 1 (依赖 + 清理 + ABI 锁定 + 破坏性移除旧栈)
    │
    ▼
Phase 2 (核心集成) ← 主体工作
    ├─ 2.1 TerminalViewModel 背压修复（Channel8192 + DROP_OLDEST）
    ├─ 2.2 TerminalEmulatorManager + ColorScheme
    ├─ 2.3 TerminalScreen 重构
    └─ 2.4 配置应用（fontSize/theme/scrollback）
    │
    ▼ 编译验证 + 压测
    │
Phase 3 (功能补充)
    ├─ 3.1 搜索（结果列表 + 跳转）
    ├─ 3.2 粘贴
    ├─ 3.3 清屏/重置
    └─ 3.4 复制选中能力确认
    │
    ▼
Phase 4 (会话恢复与后台稳定性)
    ├─ 4.1 自动重连 + reattach
    └─ 4.2 ForegroundService + WakeLock
    │
    ▼
Phase 5 (输出完整性增强，跨栈协议改造)
    └─ ByteArray 全链路 + seq/replay
    │
    ▼
Phase 6 (可选架构增强，后续评估)
    └─ SSH + tmux（mosh 不纳入当前计划）
```

交付口径：Phase 1-4 为当前版本可独立交付；Phase 5-6 单独规划发布窗口。

---

## 7. 验证方案

### 编译验证
```bash
cd android-app && ./gradlew assembleDebug
# Windows PowerShell 可用：
cd android-app; .\gradlew.bat assembleDebug
```

### 功能验证清单
| 功能 | 验证方法 |
| :--- | :--- |
| **Tab 创建** | 点击 "+"，终端立即可输入 |
| **用户输入** | 输入 `ls` + Enter，电脑端即时执行并回显 |
| **多 Tab** | 创建 3 个 Tab，切换与关闭正常 |
| **颜色输出** | `ls --color`、vim、htop，颜色与光标行为正确 |
| **CJK 字符** | 中日韩宽字符不抖动、不错位 |
| **文本选择/粘贴** | 选中复制、粘贴发送到 PTY 正常 |
| **清屏/重置** | 菜单触发后，分别发送 ANSI 清屏与 RIS 重置并生效 |
| **Resize** | 旋转设备后 rows/cols 正确同步到远端 |
| **主题切换** | DARK/LIGHT 切换无闪烁，颜色映射正确 |
| **搜索** | 结果列表可跳转到命中上下文 |
| **背压稳定性** | 大输出下 UI 不卡死，Socket 心跳不断连（无 SUSPEND 阻塞） |
| **断线恢复** | 断网后恢复网络，自动重连并恢复原 PTY 会话 |
| **前后台恢复** | 退后台 5 分钟后回到前台，仍可继续当前会话 |
| **快捷命令** | 点击快捷命令即时执行 |
| **资源占用** | 3 Tab 情况下内存与 CPU 在预算内 |

### 性能基准
| 指标 | 目标值 |
| :--- | :--- |
| **Tab 创建时间** | `< 5ms` |
| **终端首屏可交互** | `< 300ms` |
| **首次本地回显延迟** | `< 16ms` |
| **输入到远端回显（局域网）** | `< 120ms` |
| **内存/Tab** | `< 5MB` |
| **3 Tab 总内存** | `< 15MB` |
| **高吞吐 30s 压测** | 无 ANR、无崩溃、可持续交互 |
| **APK 增量** | arm64 单 ABI 下控制在 `~+1MB` 级别 |

### 回归风险
*   **ACK 链路移除**：需确认服务端不依赖 ACK 才能持续推流。
*   **动态字体/主题**：若 `initialFontSize` 或颜色更新对现有实例不生效，需 `destroy + recreate` 兜底。
*   **复制选中 API**：若 termlib 无稳定读取选区 API，需补管理层以避免功能回退。
*   **ForegroundService**：需处理通知权限、系统电池策略差异。
*   **termlib 0.0.18**：保持适配层隔离，必要时可快速 fork 修复。

---

## 8. 决策记录

### 已采纳
| 来源 | 建议 | 决策 |
|------|------|------|
| docs/3.md | termlib + Relay/PTY 作为主方案 | ✅ 采纳 |
| docs/3.md | 高性能/低占用/高速度优先，原生实现 | ✅ 采纳 |
| docs/3.md | 落地顺序先主线再架构增强 | ✅ 采纳 |
| docs/4.md | SSH + tmux 作为后续架构升级 | ✅ 采纳（调整到 Phase 6） |
| docs/4.md | mosh 不嵌入（成本过高） | ✅ 采纳 |
| 2.md A.3 | 一次性移除旧栈 | ✅ 采纳：Phase 1 直接删除全部 WebView/xterm 代码 |
| docs/5.md P0 | Phase 2.1 回退最小改动（不跨栈） | ✅ 采纳：`Channel(8192)+DROP_OLDEST` |
| docs/5.md P1 | 补清屏/重置与复制能力验证 | ✅ 采纳 |
| docs/5.md P1 | ACK 移除影响需文档化 | ✅ 采纳 |
| 本轮更新 | Phase 4 只保留会话恢复与后台稳定性 | ✅ 采纳 |
| 本轮更新 | 输出完整性增强拆分到 Phase 5 | ✅ 采纳 |

### 未采纳
| 来源 | 建议 | 决策 | 理由 |
|------|------|------|------|
| 2.md B | 双引擎架构（termlib + Termux） | ❌ 不做 | 当前阶段单引擎最符合速度和复杂度目标 |
| docs/3.md 方案3 | mosh + tmux | ❌ 不做 | 无现成 SDK、NDK 成本高、部署复杂 |
| 旧方案思路 | 视觉优先重构 Tab 栏 | ❌ 本轮不做 | 当前交付以性能与稳定性为先 |
| 上一版草案 | Phase 2 直接做 ByteArray + seq/replay | ❌ 不做 | 需服务端同步改造，超出纯客户端范围 |

---

## 9. 审计依据

1.  [ConnectBot termlib README](https://github.com/connectbot/termlib/blob/main/README.md) — 特性与已计划能力
2.  [TerminalEmulator.kt 源码](https://github.com/connectbot/termlib/blob/main/lib/src/main/java/org/connectbot/terminal/TerminalEmulator.kt) — onResize、applyColorScheme、writeInput(ByteBuffer) 等核心 API
3.  [Terminal.kt Composable 源码](https://github.com/connectbot/termlib/blob/main/lib/src/main/java/org/connectbot/terminal/Terminal.kt) — initialFontSize/min/max/forcedSize 参数
4.  [ConnectBot libs.versions.toml](https://github.com/connectbot/connectbot/blob/main/gradle/libs.versions.toml) — 确认当前依赖 termlib 0.0.18
5.  [ConnectBot release: Roll back to termlib 0.0.18](https://github.com/connectbot/connectbot/releases/tag/git-v1.9.13-409-g3e0f62d1) — 版本回退记录
6.  [libvterm 官方](https://www.leonerd.org.uk/code/libvterm/) — scrollback 由 embedder 管理
7.  [Android Compose 性能最佳实践](https://developer.android.com/develop/ui/compose/performance/bestpractices)
8.  [Android ABI 官方文档](https://developer.android.com/ndk/guides/abis)
9.  [Apache MINA SSHD](https://github.com/apache/mina-sshd) — Phase 6 SSH 路线候选
10. [SSHJ](https://github.com/hierynomus/sshj) — 轻量 SSH 客户端候选
11. [tmux](https://github.com/tmux/tmux) — 服务端会话持久化能力
12. [mosh](https://mosh.org/) — 弱网能力参考（本轮不采纳）
13. [Termux app](https://github.com/termux/termux-app) — Foreground Service / WakeLock 实践参考

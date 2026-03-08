package com.yuanio.app.ui.terminal

import org.junit.Test
import org.junit.Assert.*
import kotlin.system.measureTimeMillis
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 终端组件全面测试套件。
 *
 * 覆盖：
 * 1. SearchHelper — 写入/搜索/ANSI strip/边界/并发/Unicode
 * 2. ColorSchemeManager — 查找/注册/删除/JSON 导入导出
 * 3. SshProfile — 数据模型/默认值/枚举
 * 4. TerminalKeyboardShortcuts — 查找/标签/覆盖
 * 5. 性能压力测试 — 各组件极限吞吐
 *
 * 运行：./gradlew :app:testDebugUnitTest --tests "*.TerminalComponentTest"
 */
class TerminalComponentTest {

    // ═══════════════════════════════════════════
    // 一、TerminalSearchHelper 完整测试
    // ═══════════════════════════════════════════

    @Test
    fun `搜索 - 基本写入和搜索`() {
        val h = TerminalSearchHelper(maxLines = 100)
        h.append("hello world\n")
        h.append("hello kotlin\n")
        h.append("goodbye world\n")

        val results = h.search("hello")
        assertEquals(2, results.size)
        assertEquals("hello world", results[0].lineText)
        assertEquals("hello kotlin", results[1].lineText)
    }

    @Test
    fun `搜索 - 大小写不敏感`() {
        val h = TerminalSearchHelper()
        h.append("ERROR: something failed\n")
        h.append("error: another failure\n")
        h.append("Error: mixed case\n")

        val results = h.search("error", ignoreCase = true)
        assertEquals(3, results.size)
    }

    @Test
    fun `搜索 - 大小写敏感`() {
        val h = TerminalSearchHelper()
        h.append("ERROR: upper\n")
        h.append("error: lower\n")

        val results = h.search("ERROR", ignoreCase = false)
        assertEquals(1, results.size)
        assertEquals("ERROR: upper", results[0].lineText)
    }

    @Test
    fun `搜索 - 同一行多次匹配`() {
        val h = TerminalSearchHelper()
        h.append("aaa bbb aaa ccc aaa\n")

        val results = h.search("aaa")
        assertEquals(3, results.size)
        assertEquals(0, results[0].start)
        assertEquals(8, results[1].start)
        assertEquals(16, results[2].start)
    }

    @Test
    fun `搜索 - maxResults 截断`() {
        val h = TerminalSearchHelper()
        repeat(500) { h.append("match target line $it\n") }

        val results = h.search("match", maxResults = 50)
        assertEquals(50, results.size)
    }

    @Test
    fun `搜索 - 空查询返回空`() {
        val h = TerminalSearchHelper()
        h.append("some content\n")
        assertTrue(h.search("").isEmpty())
        assertTrue(h.search("   ").isEmpty())
    }

    @Test
    fun `搜索 - 无匹配返回空`() {
        val h = TerminalSearchHelper()
        h.append("hello world\n")
        assertTrue(h.search("xyz_not_found").isEmpty())
    }

    @Test
    fun `搜索 - ANSI 转义码自动剥离`() {
        val h = TerminalSearchHelper()
        // 模拟 ls --color 输出
        h.append("\u001B[32mREADME.md\u001B[0m  \u001B[34msrc/\u001B[0m  \u001B[1;33mpackage.json\u001B[0m\n")

        val results = h.search("README")
        assertEquals(1, results.size)
        // strip 后的文本不应包含 ANSI 码
        assertFalse(results[0].lineText.contains("\u001B"))
    }

    @Test
    fun `搜索 - 复杂 ANSI 256色和真彩色`() {
        val h = TerminalSearchHelper()
        // 256色 + 真彩色 + SGR
        h.append("\u001B[38;5;196mRED\u001B[0m \u001B[38;2;100;200;50mTRUECOLOR\u001B[0m \u001B[1;4;7mBOLD\u001B[0m normal\n")

        val results = h.search("normal")
        assertEquals(1, results.size)
        assertTrue(results[0].lineText.contains("normal"))
        assertFalse(results[0].lineText.contains("\u001B"))
    }

    @Test
    fun `搜索 - 纯 ANSI 输入被跳过`() {
        val h = TerminalSearchHelper()
        h.append("\u001B[0m")    // 纯重置
        h.append("\u001B[2J")    // 清屏
        h.append("\u001B[?25h")  // 显示光标

        assertTrue(h.search("anything").isEmpty())
    }

    @Test
    fun `搜索 - 滚动窗口正确淘汰旧行`() {
        val maxLines = 100
        val h = TerminalSearchHelper(maxLines = maxLines)

        // 写入 200 行
        repeat(200) { h.append("line-$it\n") }

        // 前 100 行应被淘汰
        assertTrue(h.search("line-0").isEmpty())
        assertTrue(h.search("line-50").isEmpty())
        assertTrue(h.search("line-99").isEmpty())

        // 后 100 行应存在
        assertFalse(h.search("line-100").isEmpty())
        assertFalse(h.search("line-199").isEmpty())
    }

    @Test
    fun `搜索 - Unicode 和中文`() {
        val h = TerminalSearchHelper()
        h.append("编译成功 ✅ Build successful\n")
        h.append("警告 ⚠️ deprecated API\n")
        h.append("错误 ❌ compilation failed\n")

        assertEquals(1, h.search("编译成功").size)
        assertEquals(1, h.search("⚠️").size)
        assertEquals(1, h.search("compilation").size)
    }

    @Test
    fun `搜索 - 日语和韩语`() {
        val h = TerminalSearchHelper()
        h.append("こんにちは世界\n")
        h.append("안녕하세요 세계\n")

        assertEquals(1, h.search("こんにちは").size)
        assertEquals(1, h.search("세계").size)
    }

    @Test
    fun `搜索 - 特殊正则字符不影响`() {
        val h = TerminalSearchHelper()
        h.append("file [test].txt (copy) {backup} *.log\n")
        h.append("price: \$100 + 50% = \$150\n")

        // 这些在正则中是特殊字符，但 search 用的是 indexOf 不是正则
        assertEquals(1, h.search("[test]").size)
        assertEquals(1, h.search("(copy)").size)
        assertEquals(1, h.search("*.log").size)
        assertEquals(1, h.search("\$100").size)
    }

    @Test
    fun `搜索 - 大批量写入和多行一次 append`() {
        val h = TerminalSearchHelper(maxLines = 5000)
        // 一次 append 多行（模拟大块输出）
        val bigChunk = buildString {
            repeat(1000) { append("batch-line-$it with some content\n") }
        }
        h.append(bigChunk)

        val results = h.search("batch-line-500")
        assertEquals(1, results.size)
    }

    @Test
    fun `搜索 - 空行和只含换行`() {
        val h = TerminalSearchHelper()
        h.append("\n\n\n")
        h.append("visible line\n")
        h.append("\n")

        val results = h.search("visible")
        assertEquals(1, results.size)
    }

    @Test
    fun `搜索 - SearchMatch 字段正确性`() {
        val h = TerminalSearchHelper()
        h.append("first line\n")
        h.append("second target line\n")

        val results = h.search("target")
        assertEquals(1, results.size)
        val match = results[0]
        assertEquals(1, match.lineIndex) // 第二行
        assertEquals(7, match.start)     // "second " 后面
        assertEquals(13, match.end)      // "target" 结束
        assertEquals("second target line", match.lineText)
    }

    // ═══════════════════════════════════════════
    // 二、ColorSchemeManager 完整测试
    // ═══════════════════════════════════════════

    @Test
    fun `配色 - 预置方案完整性`() {
        val names = ColorSchemeManager.allNames()
        assertTrue("应 >= 10 套", names.size >= 10)

        // 验证所有预置方案必须有名字和 16 色
        ColorSchemeManager.all().forEach { scheme ->
            assertTrue("方案名不应为空", scheme.name.isNotBlank())
            assertEquals("ANSI 应有 16 色", 16, scheme.ansiColors.size)
        }
    }

    @Test
    fun `配色 - 按名称查找`() {
        val dracula = ColorSchemeManager.get("Dracula")
        assertEquals("Dracula", dracula.name)

        val nord = ColorSchemeManager.get("Nord")
        assertEquals("Nord", nord.name)
    }

    @Test
    fun `配色 - 不存在的方案返回默认`() {
        val fallback = ColorSchemeManager.get("NonExistent_SCHEME_xyz")
        assertEquals(ColorSchemeManager.DEFAULT_SCHEME_NAME, fallback.name)
    }

    @Test
    fun `配色 - 自定义方案注册和删除`() {
        val custom = TerminalColorScheme(
            name = "TestCustom",
            foreground = androidx.compose.ui.graphics.Color.White,
            background = androidx.compose.ui.graphics.Color.Black,
            ansiColors = IntArray(16) { 0xFF000000.toInt() },
        )
        ColorSchemeManager.register(custom)
        assertEquals("TestCustom", ColorSchemeManager.get("TestCustom").name)

        ColorSchemeManager.remove("TestCustom")
        // 删除后应返回默认
        assertNotEquals("TestCustom", ColorSchemeManager.get("TestCustom").name)
    }

    @Test
    fun `配色 - 预置方案不可删除`() {
        val before = ColorSchemeManager.allNames().size
        ColorSchemeManager.remove("Dracula") // 尝试删除预置
        val after = ColorSchemeManager.allNames().size
        assertEquals("预置方案不可删除", before, after)
    }

    @Test
    fun `配色 - JSON 导入导出往返`() {
        val original = ColorSchemeManager.get("Tokyo Night")
        val json = ColorSchemeManager.exportToJson(original)
        assertTrue("JSON 应包含方案名", json.contains("Tokyo Night"))
        assertTrue("JSON 应包含 foreground", json.contains("foreground"))

        val reimported = ColorSchemeManager.importFromJson(json)
        assertNotNull(reimported)
        assertEquals(original.name, reimported!!.name)
        assertEquals(original.ansiColors.size, reimported.ansiColors.size)
    }

    @Test
    fun `配色 - Windows Terminal JSON 格式`() {
        // 模拟 Windows Terminal settings.json 中的配色方案
        val wtJson = """
        {
            "name": "Windows Terminal Test",
            "foreground": "#D4D4D4",
            "background": "#1E1E1E",
            "cursorColor": "#FFFFFF",
            "selectionBackground": "#264F78",
            "black": "#000000", "red": "#CD3131",
            "green": "#0DBC79", "yellow": "#E5E510",
            "blue": "#2472C8", "purple": "#BC3FBC",
            "cyan": "#11A8CD", "white": "#E5E5E5",
            "brightBlack": "#666666", "brightRed": "#F14C4C",
            "brightGreen": "#23D18B", "brightYellow": "#F5F543",
            "brightBlue": "#3B8EEA", "brightPurple": "#D670D6",
            "brightCyan": "#29B8DB", "brightWhite": "#FFFFFF"
        }
        """.trimIndent()

        val imported = ColorSchemeManager.importFromJson(wtJson)
        assertNotNull(imported)
        assertEquals("Windows Terminal Test", imported!!.name)
        assertEquals(16, imported.ansiColors.size)

        // 清理
        ColorSchemeManager.remove("Windows Terminal Test")
    }

    @Test
    fun `配色 - 无效 JSON 返回 null`() {
        assertNull(ColorSchemeManager.importFromJson("{invalid json"))
        assertNull(ColorSchemeManager.importFromJson(""))
        assertNull(ColorSchemeManager.importFromJson("null"))
    }

    @Test
    fun `配色 - 每套方案的前景背景不同`() {
        ColorSchemeManager.all().forEach { scheme ->
            assertNotEquals(
                "方案 ${scheme.name} 的前景和背景不应相同",
                scheme.foreground, scheme.background
            )
        }
    }

    // ═══════════════════════════════════════════
    // 三、SshProfile 数据模型测试
    // ═══════════════════════════════════════════

    @Test
    fun `SSH Profile - 默认值`() {
        val p = SshProfile(id = "1", name = "test", host = "example.com", username = "root")
        assertEquals(22, p.port)
        assertEquals(SshAuthMethod.PASSWORD, p.authMethod)
        assertEquals("", p.password)
        assertEquals(10_000, p.connectTimeoutMs)
        assertEquals(30, p.keepAliveIntervalSec)
        assertFalse(p.enablePortForwarding)
        assertTrue(p.portForwardingRules.isEmpty())
    }

    @Test
    fun `SSH Profile - 不同鉴权方式`() {
        SshAuthMethod.entries.forEach { method ->
            val p = SshProfile(id = "1", name = "t", host = "h", username = "u", authMethod = method)
            assertEquals(method, p.authMethod)
        }
    }

    @Test
    fun `SSH Profile - 端口转发规则格式`() {
        val p = SshProfile(
            id = "1", name = "t", host = "h", username = "u",
            enablePortForwarding = true,
            portForwardingRules = listOf("8080:localhost:80", "3306:db.internal:3306"),
        )
        assertEquals(2, p.portForwardingRules.size)
        assertTrue(p.portForwardingRules[0].split(":").size == 3)
    }

    @Test
    fun `SSH Profile - ProfileType 枚举`() {
        assertEquals(2, ProfileType.entries.size)
        assertNotNull(ProfileType.LOCAL)
        assertNotNull(ProfileType.SSH)
    }

    @Test
    fun `SSH Profile - 环境变量`() {
        val p = SshProfile(
            id = "1", name = "dev", host = "dev.server", username = "deploy",
            envVars = mapOf("TERM" to "xterm-256color", "LANG" to "en_US.UTF-8"),
        )
        assertEquals("xterm-256color", p.envVars["TERM"])
        assertEquals(2, p.envVars.size)
    }

    // ═══════════════════════════════════════════
    // 四、TerminalKeyboardShortcuts 完整测试
    // ═══════════════════════════════════════════

    @Test
    fun `快捷键 - 全部 action 有绑定`() {
        val bindings = TerminalKeyboardShortcuts.defaultBindings
        val boundActions = bindings.map { it.action }.toSet()
        // 检查所有核心 action 都有绑定
        assertTrue(boundActions.contains(TerminalAction.NEW_TAB))
        assertTrue(boundActions.contains(TerminalAction.CLOSE_TAB))
        assertTrue(boundActions.contains(TerminalAction.COMMAND_PALETTE))
        assertTrue(boundActions.contains(TerminalAction.COPY))
        assertTrue(boundActions.contains(TerminalAction.PASTE))
        assertTrue(boundActions.contains(TerminalAction.TOGGLE_SEARCH))
    }

    @Test
    fun `快捷键 - 无重复绑定`() {
        val bindings = TerminalKeyboardShortcuts.defaultBindings
        val keys = bindings.map { Triple(it.key, it.ctrl, it.shift) }
        assertEquals("不应有重复快捷键", keys.size, keys.toSet().size)
    }

    @Test
    fun `快捷键 - shortcutLabel 格式正确`() {
        val label = TerminalKeyboardShortcuts.shortcutLabel(TerminalAction.NEW_TAB)
        assertNotNull(label)
        assertTrue("应含 Ctrl", label!!.contains("Ctrl"))
        assertTrue("应含 Shift", label.contains("Shift"))
    }

    @Test
    fun `快捷键 - 不存在的 action 返回 null`() {
        // 如果某个 action 没有绑定（目前全部有绑定，但逻辑应安全）
        val allBound = TerminalAction.entries.all { action ->
            TerminalKeyboardShortcuts.shortcutLabel(action) != null
        }
        // 所有 action 都应有绑定
        assertTrue(allBound)
    }

    @Test
    fun `快捷键 - 全部绑定有描述`() {
        TerminalKeyboardShortcuts.defaultBindings.forEach { binding ->
            assertTrue(
                "绑定 ${binding.action} 应有描述",
                binding.description.isNotBlank()
            )
        }
    }

    // ═══════════════════════════════════════════
    // 五、TerminalColorScheme 数据类测试
    // ═══════════════════════════════════════════

    @Test
    fun `ColorScheme - 预置方案字段完整`() {
        listOf(
            TerminalColorScheme.DARK,
            TerminalColorScheme.LIGHT,
            TerminalColorScheme.POWERSHELL,
        ).forEach { scheme ->
            assertTrue("name 不应为空", scheme.name.isNotBlank())
            assertEquals("应有 16 色", 16, scheme.ansiColors.size)
            // cursorColor 应有值（默认为 foreground）
            assertNotNull(scheme.cursorColor)
            assertNotNull(scheme.selectionBg)
        }
    }

    @Test
    fun `ColorScheme - 默认值`() {
        val scheme = TerminalColorScheme(
            foreground = androidx.compose.ui.graphics.Color.White,
            background = androidx.compose.ui.graphics.Color.Black,
            ansiColors = IntArray(16),
        )
        assertEquals("默认 name 为空", "", scheme.name)
        // cursorColor 默认等于 foreground
        assertEquals(scheme.foreground, scheme.cursorColor)
    }

    // ═══════════════════════════════════════════
    // 六、性能压力测试（真实场景模拟）
    // ═══════════════════════════════════════════

    @Test
    fun `压力 - 模拟 cat 大文件（10万行写入）`() {
        val h = TerminalSearchHelper(maxLines = 5000)
        // 模拟真实 cat 输出：混合长短行 + ANSI 颜色
        val lines = buildString {
            repeat(100) { batch ->
                repeat(1000) { line ->
                    val n = batch * 1000 + line
                    if (n % 10 == 0) {
                        // 带颜色的特殊行
                        append("\u001B[33m[WARN]\u001B[0m line $n: something happened\n")
                    } else {
                        append("regular output line $n\n")
                    }
                }
            }
        }

        val timeMs = measureTimeMillis {
            h.append(lines)
        }

        println("📊 cat 大文件（10万行混合）写入: ${timeMs}ms")
        assertTrue("应 < 3000ms，实际: ${timeMs}ms", timeMs < 3000)
    }

    @Test
    fun `压力 - 模拟编译输出（密集 ANSI + 长路径）`() {
        val h = TerminalSearchHelper(maxLines = 5000)
        // 模拟 gcc/rustc 编译输出
        val compilerOutput = buildString {
            repeat(5000) { i ->
                append("\u001B[1;37m/home/user/projects/my-app/src/modules/feature_$i/component.rs\u001B[0m:")
                append("\u001B[1;33m${i % 100 + 1}\u001B[0m:\u001B[1;33m${i % 80 + 1}\u001B[0m: ")
                append("\u001B[1;31merror\u001B[0m\u001B[1m: unused variable `var_${i}`\u001B[0m\n")
            }
        }

        val timeMs = measureTimeMillis {
            h.append(compilerOutput)
        }

        val searchTimeMs = measureTimeMillis {
            val results = h.search("error")
            assertTrue(results.isNotEmpty())
        }

        println("📊 编译输出（5000行重 ANSI）写入: ${timeMs}ms  搜索: ${searchTimeMs}ms")
        assertTrue("写入应 < 2000ms", timeMs < 2000)
        assertTrue("搜索应 < 100ms", searchTimeMs < 100)
    }

    @Test
    fun `压力 - 模拟 npm install（快速短行）`() {
        val h = TerminalSearchHelper(maxLines = 5000)
        // 模拟 npm 高速输出
        val npmOutput = buildString {
            repeat(10000) { i ->
                append("npm \u001B[33mwarn\u001B[0m deprecated package-$i@${i % 10}.0.0: use package-${i + 1}\n")
            }
        }

        val timeMs = measureTimeMillis {
            h.append(npmOutput)
        }

        println("📊 npm install（1万行短输出）: ${timeMs}ms")
        assertTrue("应 < 2000ms", timeMs < 2000)
    }

    @Test
    fun `压力 - 并发多 Tab 写入`() {
        val helpers = List(4) { TerminalSearchHelper(maxLines = 2000) }
        val errors = ConcurrentLinkedQueue<Throwable>()
        val latch = CountDownLatch(4)

        // 模拟 4 个 Tab 并行写入
        helpers.forEachIndexed { tabIdx, helper ->
            Thread {
                try {
                    repeat(5000) { lineIdx ->
                        helper.append("Tab-$tabIdx Line-$lineIdx: some text content\n")
                    }
                    // 写完后搜索
                    val results = helper.search("Tab-$tabIdx")
                    assertTrue("Tab-$tabIdx 应有搜索结果", results.isNotEmpty())
                } catch (e: Throwable) {
                    errors.add(e)
                } finally {
                    latch.countDown()
                }
            }.start()
        }

        assertTrue("应在 10s 内完成", latch.await(10, TimeUnit.SECONDS))
        assertTrue("不应有异常: $errors", errors.isEmpty())
    }

    @Test
    fun `压力 - 配色方案高频切换`() {
        val schemes = ColorSchemeManager.all()
        val counter = AtomicInteger(0)

        val timeMs = measureTimeMillis {
            repeat(100_000) { i ->
                val scheme = schemes[i % schemes.size]
                counter.addAndGet(scheme.ansiColors.size)
            }
        }

        println("📊 10万次配色切换: ${timeMs}ms")
        assertTrue("应 < 500ms", timeMs < 500)
        assertTrue(counter.get() > 0)
    }

    @Test
    fun `压力 - JSON 序列化反序列化循环`() {
        val schemes = ColorSchemeManager.all()
        val timeMs = measureTimeMillis {
            repeat(100) {
                schemes.forEach { scheme ->
                    val json = ColorSchemeManager.exportToJson(scheme)
                    val reimported = ColorSchemeManager.importFromJson(json)
                    assertNotNull(reimported)
                }
            }
        }
        // 100 轮 × 10 套 = 1000 次序列化
        println("📊 1000次 JSON 序列化循环: ${timeMs}ms")
        assertTrue("应 < 3000ms", timeMs < 3000)
    }

    @Test
    fun `压力 - ANSI strip 真实复杂序列`() {
        val ansiRegex = Regex("""\u001B\[[0-9;?]*[ -/]*[@-~]""")
        // 真实终端混合输出
        val realOutputs = listOf(
            // git diff
            "\u001B[1;31m-old line\u001B[0m\n\u001B[1;32m+new line\u001B[0m",
            // ls --color
            "\u001B[0m\u001B[01;34mdir\u001B[0m  \u001B[01;32mexe\u001B[0m  \u001B[00mfile.txt\u001B[0m",
            // htop 风格
            "\u001B[30;42m CPU 45% \u001B[0m \u001B[30;41m MEM 78% \u001B[0m \u001B[30;43m SWP 12% \u001B[0m",
            // 光标控制
            "\u001B[H\u001B[2J\u001B[?25l\u001B[1;1H",
            // 256 色
            "\u001B[38;5;1m\u001B[48;5;236m red on dark \u001B[0m",
        )

        val timeMs = measureTimeMillis {
            repeat(50_000) { i ->
                val input = realOutputs[i % realOutputs.size]
                ansiRegex.replace(input, "")
            }
        }

        println("📊 5万次真实 ANSI strip: ${timeMs}ms")
        assertTrue("应 < 2000ms", timeMs < 2000)
    }

    @Test
    fun `压力 - 搜索高频调用（模拟用户实时输入）`() {
        val h = TerminalSearchHelper(maxLines = 5000)
        repeat(5000) { i ->
            h.append("user@host:~/project\$ some command output line $i result ok\n")
        }

        // 模拟用户逐字输入 "command" 的搜索过程
        val queries = listOf("c", "co", "com", "comm", "comma", "comman", "command")
        val timeMs = measureTimeMillis {
            repeat(100) { // 模拟 100 次完整输入过程
                queries.forEach { q ->
                    h.search(q)
                }
            }
        }

        println("📊 实时搜索（700次查询）: ${timeMs}ms")
        assertTrue("应 < 3000ms", timeMs < 3000)
    }
}

package sy.yuanio.app.ui.terminal

import org.junit.Test
import org.junit.Assert.*
import kotlin.system.measureTimeMillis

/**
 * 终端组件压力测试。
 *
 * 覆盖场景：
 * 1. TerminalSearchHelper 大批量写入 + 搜索性能
 * 2. ANSI 正则 strip 吞吐量
 * 3. ColorSchemeManager 查找性能
 * 4. 并发写入安全性
 *
 * 运行：./gradlew :app:testDebugUnitTest --tests "*.TerminalPerformanceTest"
 */
class TerminalPerformanceTest {

    // ── 1. SearchHelper 大批量写入 ──

    @Test
    fun `搜索辅助 - 10万行写入`() {
        val helper = TerminalSearchHelper(maxLines = 5000)
        val line = "user@host:~/project\$ ls -la | grep something interesting\n"
        val batch = line.repeat(1000) // 1000 行批量写入

        val timeMs = measureTimeMillis {
            repeat(100) { // 100 批 × 1000 行 = 10万行
                helper.append(batch)
            }
        }

        println("📊 10万行写入耗时: ${timeMs}ms")
        assertTrue("10万行写入应 < 2000ms，实际: ${timeMs}ms", timeMs < 2000)
    }

    @Test
    fun `搜索辅助 - 5000行中搜索`() {
        val helper = TerminalSearchHelper(maxLines = 5000)
        // 写入 5000 行，每 50 行包含一个特殊标记
        repeat(5000) { i ->
            val line = if (i % 50 == 0) {
                "ERROR: something went wrong at line $i\n"
            } else {
                "normal output line $i with some text content here\n"
            }
            helper.append(line)
        }

        val timeMs = measureTimeMillis {
            repeat(100) { // 执行 100 次搜索
                val results = helper.search("ERROR")
                assertTrue("应找到约 100 个匹配", results.size in 90..110)
            }
        }

        println("📊 5000行搜索100次耗时: ${timeMs}ms")
        assertTrue("搜索100次应 < 500ms，实际: ${timeMs}ms", timeMs < 500)
    }

    @Test
    fun `搜索辅助 - 长行搜索`() {
        val helper = TerminalSearchHelper(maxLines = 5000)
        // 模拟编译器输出的超长行（500字符/行）
        val longLine = "a".repeat(480) + " ERROR target " + "b".repeat(6) + "\n"
        repeat(2000) { helper.append(longLine) }

        val timeMs = measureTimeMillis {
            repeat(50) {
                val results = helper.search("ERROR target")
                assertEquals(200, results.size) // maxResults 默认 200
            }
        }

        println("📊 长行搜索50次耗时: ${timeMs}ms")
        assertTrue("长行搜索50次应 < 1000ms，实际: ${timeMs}ms", timeMs < 1000)
    }

    // ── 2. ANSI Strip 正则性能 ──

    @Test
    fun `ANSI strip - 10万次正则替换`() {
        val ansiRegex = Regex("""\u001B\[[0-9;?]*[ -/]*[@-~]""")
        val heavyAnsi = "\u001B[38;5;196mRED\u001B[0m \u001B[48;5;226m\u001B[30mBLACK ON YELLOW\u001B[0m " +
            "\u001B[1;4;32mBOLD UNDERLINE GREEN\u001B[0m normal text \u001B[38;2;100;200;50mTRUECOLOR\u001B[0m"

        var totalLength = 0L
        val timeMs = measureTimeMillis {
            repeat(100_000) {
                totalLength += ansiRegex.replace(heavyAnsi, "").length
            }
        }

        println("📊 10万次 ANSI strip 耗时: ${timeMs}ms (平均 ${totalLength / 100_000} 字符/次)")
        assertTrue("10万次 ANSI strip 应 < 2000ms，实际: ${timeMs}ms", timeMs < 2000)
    }

    @Test
    fun `ANSI strip - 大块数据`() {
        val ansiRegex = Regex("""\u001B\[[0-9;?]*[ -/]*[@-~]""")
        // 模拟 8KB 终端输出块（混合 ANSI 和文本）
        val chunk = buildString {
            repeat(100) {
                append("\u001B[32m")
                append("output line $it with some normal text content here")
                append("\u001B[0m\n")
            }
        }
        assertTrue("测试数据应 > 5KB", chunk.length > 5000)

        val timeMs = measureTimeMillis {
            repeat(10_000) {
                ansiRegex.replace(chunk, "")
            }
        }

        println("📊 1万次大块 ANSI strip 耗时: ${timeMs}ms (数据块 ${chunk.length} 字符)")
        assertTrue("1万次大块 strip 应 < 5000ms，实际: ${timeMs}ms", timeMs < 5000)
    }

    // ── 3. ColorSchemeManager 性能 ──

    @Test
    fun `配色方案 - 快速查找`() {
        val names = ColorSchemeManager.allNames()
        assertTrue("应有 >= 10 套方案", names.size >= 10)

        val timeMs = measureTimeMillis {
            repeat(100_000) { i ->
                val name = names[i % names.size]
                val scheme = ColorSchemeManager.get(name)
                assertNotNull(scheme)
            }
        }

        println("📊 10万次配色查找耗时: ${timeMs}ms")
        assertTrue("10万次查找应 < 200ms，实际: ${timeMs}ms", timeMs < 200)
    }

    @Test
    fun `配色方案 - JSON 导入导出`() {
        val json = ColorSchemeManager.exportToJson(ColorSchemeManager.get("Dracula"))

        val timeMs = measureTimeMillis {
            repeat(1000) {
                val imported = ColorSchemeManager.importFromJson(json)
                assertNotNull(imported)
            }
        }

        println("📊 1000次 JSON 导入导出耗时: ${timeMs}ms")
        assertTrue("1000次导入应 < 1000ms，实际: ${timeMs}ms", timeMs < 1000)
    }

    // ── 4. SearchHelper 边界场景 ──

    @Test
    fun `搜索辅助 - 滚动窗口淘汰`() {
        val maxLines = 1000
        val helper = TerminalSearchHelper(maxLines = maxLines)

        // 写入远超 maxLines 的数据
        repeat(5000) { i ->
            helper.append("line-$i unique-marker-$i\n")
        }

        // 确认旧数据被淘汰
        val old = helper.search("unique-marker-0")
        assertTrue("0号行应已被淘汰", old.isEmpty())

        val recent = helper.search("unique-marker-4999")
        assertTrue("最新行应仍可搜索到", recent.isNotEmpty())

        // 搜索量在合理范围
        val all = helper.search("unique-marker")
        assertTrue("搜索结果应为 maxResults 内", all.size in 1..200)
    }

    @Test
    fun `搜索辅助 - 空输入和特殊字符`() {
        val helper = TerminalSearchHelper()

        // 空输入不应崩溃
        helper.append("")
        helper.append("\u001B[0m") // 纯 ANSI（strip 后为空）

        val results = helper.search("") // 空搜索
        assertTrue("空搜索应返回空列表", results.isEmpty())

        // 特殊正则字符不应崩溃
        helper.append("test [bracket] (paren) {brace} *.glob?\n")
        val bracket = helper.search("[bracket]")
        assertTrue("特殊字符搜索应工作", bracket.isNotEmpty())
    }

    // ── 5. 键盘快捷键查找性能 ──

    @Test
    fun `快捷键 - 查找性能`() {
        val bindings = TerminalKeyboardShortcuts.defaultBindings
        assertTrue("应有 >= 10 个绑定", bindings.size >= 10)

        val timeMs = measureTimeMillis {
            repeat(100_000) {
                // 模拟查找（不通过真实 KeyEvent）
                TerminalKeyboardShortcuts.shortcutLabel(TerminalAction.NEW_TAB)
                TerminalKeyboardShortcuts.shortcutLabel(TerminalAction.COMMAND_PALETTE)
                TerminalKeyboardShortcuts.shortcutLabel(TerminalAction.COPY)
            }
        }

        println("📊 30万次快捷键查找耗时: ${timeMs}ms")
        assertTrue("30万次查找应 < 500ms，实际: ${timeMs}ms", timeMs < 500)
    }
}


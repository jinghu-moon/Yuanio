package com.yuanio.app.data

/**
 * 过滤 Agent 输出中的 TUI 噪声，保持聊天界面干净。
 * 借鉴 teleclaude 的 NOISE_PATTERNS。
 */
object NoiseFilter {

    private val NOISE_PATTERNS = listOf(
        Regex("""(?i)bypass permissions"""),
        Regex("""(?i)shift\+tab to cycle"""),
        Regex("""(?i)esc to (interrupt|cancel)"""),
        Regex("""(?i)press enter to confirm"""),
        Regex("""(?i)tab to autocomplete"""),
        Regex("""(?i)↑/↓ to navigate"""),
        Regex("""(?i)ctrl\+c to (exit|cancel|abort)"""),
        Regex("""^\s*[─━═]{3,}\s*$"""),
        Regex("""^\s*\u001b\[[\d;]*[a-zA-Z]"""),  // ANSI escape sequences
        // CLI 适配层状态事件（仅调试时可能注入到正文）
        Regex("""^\s*\[(claude|codex|gemini)]\s+(claude|codex|gemini)\s+(thread\.started|turn\.started|turn completed|done)\s*$""", RegexOption.IGNORE_CASE),
        Regex("""^\s*(codex|gemini)\s+(thread\.started|turn\.started|turn completed|done)\s*$""", RegexOption.IGNORE_CASE),
    )

    fun clean(text: String): String {
        if (text.isBlank()) return text
        return text.lines()
            .filterNot { line -> NOISE_PATTERNS.any { it.containsMatchIn(line) } }
            .joinToString("\n")
    }
}

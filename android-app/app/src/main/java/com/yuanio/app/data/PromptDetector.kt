package com.yuanio.app.data

/**
 * 检测 AI 消息中的交互式提示（yes/no、选择题等），
 * 返回建议的快捷回复选项。
 * 内置 15 秒冷却期 + 4 秒稳定阈值，防止 chips 频繁闪烁。
 */
object PromptDetector {

    data class QuickReply(val label: String, val value: String)

    private const val COOLDOWN_MS = 15_000L
    private const val STABLE_MS = 4_000L

    private var lastTriggeredAt = 0L
    private var lastDetectedAt = 0L
    private var lastDetectedHash = 0
    private var cachedReplies: List<QuickReply> = emptyList()

    private val YES_NO_PATTERNS = listOf(
        Regex("""(?i)\b(do you want|would you like|shall I|should I|want me to)\b.*\?"""),
        Regex("""(?i)\b(proceed|continue|go ahead)\b.*\?"""),
        Regex("""(?i)\b(yes\s*(/|or)\s*no)\b"""),
        Regex("""(?i)\b(confirm|approve)\b.*\?"""),
        Regex("""(?i)\(y/n\)"""),
    )

    private val CHOICE_PATTERN = Regex("""(?m)^\s*(\d+)[.)]\s+(.+)""")

    fun detect(text: String): List<QuickReply> {
        if (text.isBlank()) return emptyList()
        val now = System.currentTimeMillis()

        // 冷却期内不触发新检测
        if (now - lastTriggeredAt < COOLDOWN_MS) return emptyList()

        val hash = text.takeLast(500).hashCode()
        if (hash != lastDetectedHash) {
            // 内容变化，重置稳定计时
            lastDetectedHash = hash
            lastDetectedAt = now
            cachedReplies = detectInternal(text)
            return emptyList()
        }

        // 内容稳定超过阈值才展示
        if (now - lastDetectedAt < STABLE_MS) return emptyList()

        return cachedReplies
    }

    /** 用户点击快捷回复后调用，开始冷却 */
    fun markTriggered() {
        lastTriggeredAt = System.currentTimeMillis()
        cachedReplies = emptyList()
    }

    private fun detectInternal(text: String): List<QuickReply> {
        val last500 = text.takeLast(500)

        // 检测编号选项 (1. xxx  2. xxx)
        val choices = CHOICE_PATTERN.findAll(last500).toList()
        if (choices.size in 2..6) {
            return choices.map { m ->
                val num = m.groupValues[1]
                val label = m.groupValues[2].trim().take(30)
                QuickReply("$num. $label", num)
            }
        }

        // 检测 yes/no 类提示
        if (YES_NO_PATTERNS.any { it.containsMatchIn(last500) }) {
            return listOf(
                QuickReply("✅ Yes", "yes"),
                QuickReply("❌ No", "no"),
            )
        }

        return emptyList()
    }
}

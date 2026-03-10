package sy.yuanio.app.ui.terminal

data class SearchMatch(
    val lineIndex: Int,
    val start: Int,
    val end: Int,
    val lineText: String,
)

/**
 * 终端搜索辅助：维护纯文本滚动窗口，提供 match 列表与 next/prev 导航。
 */
class TerminalSearchHelper(
    private val maxLines: Int = 5000,
) {
    private val lines = ArrayDeque<String>(maxLines + 64)

    fun append(chunk: String) {
        if (chunk.isEmpty()) return
        val clean = stripAnsi(chunk)
        if (clean.isEmpty()) return
        val segments = clean.split('\n')
        val segmentCount = if (clean.endsWith('\n')) segments.size - 1 else segments.size
        for (index in 0 until segmentCount) {
            val line = segments[index].removeSuffix("\r")
            lines.addLast(line)
            while (lines.size > maxLines) {
                lines.removeFirst()
            }
        }
    }

    fun search(query: String, ignoreCase: Boolean = true, maxResults: Int = 200): List<SearchMatch> {
        if (query.isBlank()) return emptyList()
        val q = if (ignoreCase) query.lowercase() else query
        val result = ArrayList<SearchMatch>(32)
        lines.forEachIndexed { idx, raw ->
            val line = if (ignoreCase) raw.lowercase() else raw
            var start = line.indexOf(q)
            while (start >= 0) {
                result += SearchMatch(
                    lineIndex = idx,
                    start = start,
                    end = start + q.length,
                    lineText = raw,
                )
                if (result.size >= maxResults) return result
                start = line.indexOf(q, start + q.length)
            }
        }
        return result
    }

    private fun stripAnsi(text: String): String = ANSI_REGEX.replace(text, "")

    companion object {
        private val ANSI_REGEX = Regex("""\u001B\[[0-9;?]*[ -/]*[@-~]""")
    }
}


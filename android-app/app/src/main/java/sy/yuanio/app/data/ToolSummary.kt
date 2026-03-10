package sy.yuanio.app.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * 借鉴 teleclaude _tool_summary() 模式，
 * 将工具名 + params 转为友好的一行摘要。
 */
object ToolSummary {

    data class Summary(val icon: String, val label: String, val detail: String)

    fun generate(tool: String, params: JSONObject?): Summary {
        val p = params ?: JSONObject()
        return when (tool.lowercase()) {
            // 文件读取
            "read" -> Summary("📖", "Read", truncPath(p.optString("file_path", p.optString("path", ""))))
            // 文件写入
            "write" -> Summary("📝", "Write", truncPath(p.optString("file_path", p.optString("path", ""))))
            // 文件编辑
            "edit" -> Summary("✏️", "Edit", truncPath(p.optString("file_path", p.optString("path", ""))))
            // 命令执行
            "bash", "command_execution", "command-execution" -> Summary("⚡", "Bash", truncCmd(commandFromParams(p)))
            // 搜索
            "grep" -> Summary("🔍", "Grep", p.optString("pattern", ""))
            "glob" -> Summary("🔎", "Glob", p.optString("pattern", ""))
            // 网络
            "webfetch" -> Summary("🌐", "Fetch", p.optString("url", ""))
            "websearch", "web_search" -> Summary("🔎", "Search", p.optString("query", ""))
            // 任务
            "task" -> Summary("🤖", "Task", p.optString("description", ""))
            // LSP
            "lsp" -> Summary("🧠", "LSP", p.optString("operation", ""))
            // 笔记本
            "notebookedit" -> Summary("📓", "Notebook", truncPath(p.optString("notebook_path", "")))
            // 通用
            else -> Summary("🔧", tool, firstParamPreview(p))
        }
    }

    /** 格式化为单行显示文本 */
    fun formatOneLiner(tool: String, params: JSONObject?): String {
        val s = generate(tool, params)
        return if (s.detail.isNotBlank()) "${s.icon} ${s.label}  ${s.detail}" else "${s.icon} ${s.label}"
    }

    private fun truncPath(path: String): String {
        if (path.isBlank()) return ""
        // 只保留最后两级路径
        val parts = path.replace("\\", "/").split("/")
        return if (parts.size > 2) "…/" + parts.takeLast(2).joinToString("/") else path
    }

    private fun truncCmd(cmd: String): String {
        if (cmd.isBlank()) return ""
        val first = cmd.lineSequence().first().trim()
        return if (first.length > 80) first.take(77) + "…" else first
    }

    private fun commandFromParams(p: JSONObject): String {
        val keys = listOf("command", "cmd", "shell_command", "input", "args", "argv", "script")
        for (key in keys) {
            val v = flattenValue(p.opt(key))
            if (v.isNotBlank()) return v
        }
        return ""
    }

    private fun flattenValue(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> ""
            is String -> value.trim()
            is Number, is Boolean -> value.toString()
            is JSONArray -> {
                val parts = mutableListOf<String>()
                for (i in 0 until value.length()) {
                    val part = flattenValue(value.opt(i))
                    if (part.isNotBlank()) parts.add(part)
                }
                parts.joinToString(" ").trim()
            }
            is JSONObject -> {
                val program = value.optString("program", "").trim()
                val args = flattenValue(value.opt("args"))
                if (program.isNotBlank()) {
                    return if (args.isNotBlank()) "$program $args".trim() else program
                }
                val keys = listOf("command", "cmd", "shell_command", "input", "args", "argv", "script", "text")
                for (key in keys) {
                    val nested = flattenValue(value.opt(key))
                    if (nested.isNotBlank()) return nested
                }
                ""
            }
            else -> value.toString().trim()
        }
    }

    private fun firstParamPreview(p: JSONObject): String {
        val keys = p.keys()
        if (!keys.hasNext()) return ""
        val k = keys.next()
        val v = flattenValue(p.opt(k))
        return if (v.length > 60) v.take(57) + "…" else v
    }
}


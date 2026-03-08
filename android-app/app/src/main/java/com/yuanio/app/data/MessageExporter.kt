package com.yuanio.app.data

import android.content.Context
import android.content.Intent
import com.yuanio.app.R
import com.yuanio.app.ui.model.ChatItem
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object MessageExporter {

    fun toMarkdown(context: Context, items: List<ChatItem>, sessionId: String): String {
        val sb = StringBuilder()
        val now = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
        val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

        sb.appendLine(context.getString(R.string.message_exporter_title))
        sb.appendLine()
        sb.appendLine(context.getString(R.string.message_exporter_session_id, sessionId))
        sb.appendLine(context.getString(R.string.message_exporter_export_time, now))
        sb.appendLine()
        sb.appendLine("---")
        sb.appendLine()

        for (item in items) {
            when (item) {
                is ChatItem.Text -> {
                    val role = if (item.role == "user") {
                        context.getString(R.string.message_exporter_role_user)
                    } else {
                        context.getString(R.string.message_exporter_role_ai)
                    }
                    val time = timeFmt.format(Date(item.ts))
                    sb.appendLine("### $role [$time]")
                    sb.appendLine()
                    sb.appendLine(item.content)
                    sb.appendLine()
                }
                is ChatItem.ToolCall -> {
                    sb.appendLine(context.getString(R.string.message_exporter_tool_call, item.tool, item.status))
                    item.result?.let { sb.appendLine(context.getString(R.string.message_exporter_result, it)) }
                    sb.appendLine()
                }
                is ChatItem.Thinking, is ChatItem.UsageInfo -> {
                    // Thinking 与 token 统计为临时态，不导出
                }
                is ChatItem.FileDiff -> {
                    sb.appendLine(context.getString(R.string.message_exporter_file_change, item.path, item.action))
                    sb.appendLine()
                }
                is ChatItem.Approval, is ChatItem.HookEvent -> {
                    // 跳过审批和 Hook 事件
                }
                is ChatItem.TodoUpdate -> {
                    sb.appendLine(context.getString(R.string.message_exporter_todo_update, item.todos.size))
                    item.todos.forEach { t -> sb.appendLine("> - [${t.status}] ${t.content}") }
                    sb.appendLine()
                }
            }
        }
        return sb.toString()
    }

    fun share(context: Context, markdown: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, markdown)
            putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.message_exporter_subject))
        }
        context.startActivity(
            Intent.createChooser(intent, context.getString(R.string.message_exporter_share_chooser))
        )
    }
}

package com.yuanio.app.ui.model

import androidx.compose.runtime.Immutable
import com.yuanio.app.data.TodoItem

@Immutable
enum class DeliveryStatus { SENDING, DELIVERED, READ }

@Immutable
enum class ApprovalType {
    EXEC,
    EDIT,
    MCP,
    GENERIC;

    companion object {
        fun fromTool(tool: String): ApprovalType {
            val normalized = tool.trim().lowercase()
            return when {
                normalized in setOf("bash", "shell", "sh", "powershell", "exec") -> EXEC
                normalized.contains("write") || normalized.contains("edit") || normalized.contains("patch") || normalized.contains("diff") -> EDIT
                normalized.contains("mcp") -> MCP
                else -> GENERIC
            }
        }
    }
}

@Immutable
sealed class ChatItem {
    abstract val agent: String?

    open val stableKey: String
        get() = when (this) {
            is Text -> "text:$id"
            is Thinking -> "thinking:${turnId ?: "${agent.orEmpty()}:${ephemeral}"}"
            is ToolCall -> "tool:${toolUseId ?: "${tool}:${status}:${summary.orEmpty()}"}"
            is UsageInfo -> "usage:${taskId ?: "${inputTokens}:${outputTokens}:${cacheCreationTokens}:${cacheReadTokens}"}"
            is FileDiff -> "file_diff:$path:$action:${diff.hashCode()}"
            is Approval -> "approval:$id"
            is HookEvent -> "hook:$hook:$event:${tool.orEmpty()}"
            is TodoUpdate -> "todo:${taskId ?: todos.joinToString(separator = ",") { it.id.ifBlank { it.content } }}"
        }

    @Immutable
    data class Text(
        val role: String,
        val content: String,
        val ts: Long = System.currentTimeMillis(),
        val failed: Boolean = false,
        val delivery: DeliveryStatus? = null,
        val id: String = "msg_${System.currentTimeMillis()}_${(1000..9999).random()}",
        val editedCount: Int = 0,
        val editedAt: Long? = null,
        val originalContent: String? = null,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class Thinking(
        val content: String,
        val turnId: String? = null,
        val ephemeral: Boolean = false,
        val done: Boolean = false,
        val phase: String? = null,
        val elapsedMs: Long? = null,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class ToolCall(
        val tool: String,
        val status: String,
        val result: String?,
        val summary: String? = null,
        val toolUseId: String? = null,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class UsageInfo(
        val inputTokens: Int = 0,
        val outputTokens: Int = 0,
        val cacheCreationTokens: Int = 0,
        val cacheReadTokens: Int = 0,
        val taskId: String? = null,
        override val agent: String? = null,
    ) : ChatItem() {
        val totalTokens: Int
            get() = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    }

    @Immutable
    data class FileDiff(
        val path: String,
        val diff: String,
        val action: String,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class Approval(
        val id: String,
        val desc: String,
        val tool: String,
        val files: List<String>,
        val approvalType: ApprovalType = ApprovalType.fromTool(tool),
        val riskLevel: String = "medium",
        val riskSummary: String = "",
        val diffHighlights: List<String> = emptyList(),
        val preview: String? = null,
        val context: String? = null,
        val permissionMode: String? = null,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class HookEvent(
        val hook: String,
        val event: String,
        val tool: String?,
        override val agent: String? = null,
    ) : ChatItem()

    @Immutable
    data class TodoUpdate(
        val todos: List<TodoItem>,
        val taskId: String? = null,
        override val agent: String? = null,
    ) : ChatItem()
}

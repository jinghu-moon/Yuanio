package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.ChatHistoryEntry

data class TaskChatActivityEntry(
    val taskId: String,
    val role: String,
    val summary: String,
    val ts: Long,
    val agent: String? = null,
)

internal fun buildTaskChatActivityMap(entries: List<ChatHistoryEntry>): Map<String, TaskChatActivityEntry> {
    return buildTaskChatActivityEntries(entries)
        .groupBy { it.taskId }
        .mapValues { (_, items) -> items.maxByOrNull { it.ts } ?: items.last() }
}

internal fun buildTaskChatTimeline(
    entries: List<ChatHistoryEntry>,
    taskId: String,
    limit: Int = 6,
): List<TaskChatActivityEntry> {
    val normalizedTaskId = taskId.trim()
    if (normalizedTaskId.isBlank()) return emptyList()
    return buildTaskChatActivityEntries(entries)
        .filter { it.taskId == normalizedTaskId }
        .sortedByDescending { it.ts }
        .take(limit)
}

internal fun resolveTaskChatPreview(
    entries: List<ChatHistoryEntry>,
    taskId: String,
): TaskChatActivityEntry? {
    val normalizedTaskId = taskId.trim()
    if (normalizedTaskId.isBlank()) return null
    return buildTaskChatActivityMap(entries)[normalizedTaskId]
}

internal fun buildTaskChatActivityEntries(entries: List<ChatHistoryEntry>): List<TaskChatActivityEntry> {
    val out = mutableListOf<TaskChatActivityEntry>()
    var activeTaskId: String? = null
    entries.forEachIndexed { index, entry ->
        val resolvedTaskId = resolveEntryTaskId(entry, activeTaskId)
        if (resolvedTaskId != null) {
            activeTaskId = resolvedTaskId
            out += TaskChatActivityEntry(
                taskId = resolvedTaskId,
                role = entry.type,
                summary = summarizeTaskChatEntry(entry),
                ts = if (entry.ts > 0L) entry.ts else index.toLong(),
                agent = entry.agent,
            )
        }
    }
    return out
}

private fun resolveEntryTaskId(entry: ChatHistoryEntry, activeTaskId: String?): String? {
    return entry.taskId?.trim()?.ifBlank { null }
        ?: extractTaskIdFromContent(entry.content)
        ?: activeTaskId
}

private fun extractTaskIdFromContent(content: String): String? {
    return Regex("""/task\s+([a-zA-Z0-9._:-]{6,})""")
        .find(content)
        ?.groupValues
        ?.getOrNull(1)
        ?.trim()
        ?.ifBlank { null }
}

private fun summarizeTaskChatEntry(entry: ChatHistoryEntry): String {
    return entry.content
        .lineSequence()
        .map { it.trim() }
        .firstOrNull { it.isNotBlank() }
        ?.take(72)
        ?: ""
}


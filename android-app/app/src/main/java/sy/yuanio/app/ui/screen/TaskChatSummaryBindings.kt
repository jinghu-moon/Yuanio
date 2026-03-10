package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.ChatHistoryEntry

internal data class HomeTaskChatPreviewBinding(
    val latestTaskPreview: TaskChatActivityEntry? = null,
    val latestResultPreview: TaskChatActivityEntry? = null,
    val pendingApprovalTaskPreview: TaskChatActivityEntry? = null,
)

internal fun resolveHomeTaskChatPreviewBinding(
    entries: List<ChatHistoryEntry>,
    latestTaskId: String?,
    latestResultTaskId: String?,
    pendingApprovalTaskId: String?,
): HomeTaskChatPreviewBinding {
    return HomeTaskChatPreviewBinding(
        latestTaskPreview = resolveTaskChatPreviewOrNull(entries, latestTaskId),
        latestResultPreview = resolveTaskChatPreviewOrNull(entries, latestResultTaskId),
        pendingApprovalTaskPreview = resolveTaskChatPreviewOrNull(entries, pendingApprovalTaskId),
    )
}

internal fun resolveResultTaskChatPreview(
    entries: List<ChatHistoryEntry>,
    selectedTaskId: String?,
): TaskChatActivityEntry? {
    return resolveTaskChatPreviewOrNull(entries, selectedTaskId)
}

internal fun resolveApprovalTaskChatPreview(
    entries: List<ChatHistoryEntry>,
    lastResultTaskId: String?,
): TaskChatActivityEntry? {
    return resolveTaskChatPreviewOrNull(entries, lastResultTaskId)
}

private fun resolveTaskChatPreviewOrNull(
    entries: List<ChatHistoryEntry>,
    taskId: String?,
): TaskChatActivityEntry? {
    val normalizedTaskId = taskId?.trim().orEmpty()
    if (normalizedTaskId.isBlank()) return null
    return resolveTaskChatPreview(entries, normalizedTaskId)?.takeIf { it.summary.isNotBlank() }
}


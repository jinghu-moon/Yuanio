package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowTaskSummary

internal fun resolveHomeResultTaskId(
    focusedTaskId: String?,
    latestResultSummary: WorkflowTaskSummary?,
): String? {
    val normalizedFocusedTaskId = focusedTaskId?.trim().orEmpty()
    if (normalizedFocusedTaskId.isNotBlank()) {
        return normalizedFocusedTaskId
    }
    val summaryTaskId = latestResultSummary?.taskId?.trim().orEmpty()
    return summaryTaskId.ifBlank { null }
}


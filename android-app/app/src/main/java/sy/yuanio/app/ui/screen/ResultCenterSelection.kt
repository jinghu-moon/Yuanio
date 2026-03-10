package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowTaskSummary

internal data class ResultSummarySelection(
    val selectedSummary: WorkflowTaskSummary?,
    val summaries: List<WorkflowTaskSummary>,
)

internal fun resolveResultSummarySelection(
    requestedTaskId: String?,
    snapshot: WorkflowSnapshot,
): ResultSummarySelection {
    val summaries = snapshot.recentTaskSummaries
    val normalizedTaskId = requestedTaskId?.trim().orEmpty()
    val selectedSummary = summaries.firstOrNull { it.taskId == normalizedTaskId }
        ?: summaries.firstOrNull()
    return ResultSummarySelection(
        selectedSummary = selectedSummary,
        summaries = summaries,
    )
}


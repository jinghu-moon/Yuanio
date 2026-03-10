package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowTaskSummary

internal data class TaskSummarySections(
    val pinned: List<WorkflowTaskSummary>,
    val recent: List<WorkflowTaskSummary>,
)

internal fun splitTaskSummariesForDisplay(
    summaries: List<WorkflowTaskSummary>,
    pinnedTaskIds: List<String>,
): TaskSummarySections {
    if (summaries.isEmpty()) return TaskSummarySections(emptyList(), emptyList())
    if (pinnedTaskIds.isEmpty()) return TaskSummarySections(emptyList(), summaries)
    val normalizedPinned = pinnedTaskIds.mapNotNull { id ->
        id.trim().takeIf { it.isNotBlank() }
    }
    if (normalizedPinned.isEmpty()) return TaskSummarySections(emptyList(), summaries)
    val pinned = mutableListOf<WorkflowTaskSummary>()
    val pinnedSet = mutableSetOf<String>()
    normalizedPinned.forEach { targetId ->
        val summary = summaries.firstOrNull { it.taskId == targetId } ?: return@forEach
        if (pinnedSet.add(summary.taskId)) {
            pinned.add(summary)
        }
    }
    if (pinned.isEmpty()) return TaskSummarySections(emptyList(), summaries)
    val recent = summaries.filterNot { it.taskId in pinnedSet }
    return TaskSummarySections(pinned = pinned, recent = recent)
}

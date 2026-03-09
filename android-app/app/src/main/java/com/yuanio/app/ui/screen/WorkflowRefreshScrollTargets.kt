package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowSnapshot

private data class TaskSectionOffsets(
    val queueItemsStartIndex: Int?,
    val runningItemsStartIndex: Int?,
    val recentSummaryItemsStartIndex: Int?,
)

enum class TaskRefreshFocusKind {
    NONE,
    LATEST_SUMMARY,
    RUNNING_TASK,
    QUEUED_TASK,
}

data class TaskRefreshScrollTarget(
    val index: Int,
    val focusKind: TaskRefreshFocusKind,
    val taskId: String? = null,
)

enum class ApprovalRefreshFocusKind {
    NONE,
    FOCUSED_APPROVAL,
    FIRST_APPROVAL,
}

data class ApprovalRefreshScrollTarget(
    val index: Int,
    val focusKind: ApprovalRefreshFocusKind,
)

internal fun resolveTaskRefreshScrollTarget(snapshot: WorkflowSnapshot): TaskRefreshScrollTarget {
    val offsets = resolveTaskSectionOffsets(snapshot)
    if (snapshot.recentTaskSummaries.isNotEmpty()) {
        return TaskRefreshScrollTarget(
            index = offsets.recentSummaryItemsStartIndex ?: 0,
            focusKind = TaskRefreshFocusKind.LATEST_SUMMARY,
            taskId = snapshot.recentTaskSummaries.firstOrNull()?.taskId,
        )
    }
    if (snapshot.runningTaskIds.isNotEmpty()) {
        return TaskRefreshScrollTarget(
            index = offsets.runningItemsStartIndex ?: 0,
            focusKind = TaskRefreshFocusKind.RUNNING_TASK,
            taskId = snapshot.runningTaskIds.firstOrNull(),
        )
    }
    if (snapshot.queuedTasks.isNotEmpty()) {
        return TaskRefreshScrollTarget(
            index = offsets.queueItemsStartIndex ?: 0,
            focusKind = TaskRefreshFocusKind.QUEUED_TASK,
            taskId = snapshot.queuedTasks.firstOrNull()?.id,
        )
    }
    return TaskRefreshScrollTarget(index = 0, focusKind = TaskRefreshFocusKind.NONE)
}

internal fun resolveRequestedTaskScrollTarget(
    requestedFocus: String?,
    snapshot: WorkflowSnapshot,
): TaskRefreshScrollTarget? {
    return resolveRequestedTaskScrollTarget(
        requestedFocus = requestedFocus,
        requestedTaskId = null,
        snapshot = snapshot,
    )
}

internal fun resolveRequestedTaskScrollTarget(
    requestedFocus: String?,
    requestedTaskId: String? = null,
    snapshot: WorkflowSnapshot,
): TaskRefreshScrollTarget? {
    val normalizedFocus = requestedFocus?.trim()?.lowercase().orEmpty()
    val normalizedTaskId = requestedTaskId?.trim().orEmpty()
    if (normalizedFocus.isBlank()) return null
    if (
        snapshot.updatedAt <= 0L &&
        snapshot.recentTaskSummaries.isEmpty() &&
        snapshot.runningTaskIds.isEmpty() &&
        snapshot.queuedTasks.isEmpty()
    ) {
        return null
    }

    val offsets = resolveTaskSectionOffsets(snapshot)
    return when (normalizedFocus) {
        "latest" -> {
            if (snapshot.recentTaskSummaries.isNotEmpty()) {
                val matchedIndex = snapshot.recentTaskSummaries.indexOfFirst { it.taskId == normalizedTaskId }
                val resolvedIndex = offsets.recentSummaryItemsStartIndex ?: 0
                TaskRefreshScrollTarget(
                    index = if (matchedIndex >= 0) resolvedIndex + matchedIndex else resolvedIndex,
                    focusKind = TaskRefreshFocusKind.LATEST_SUMMARY,
                    taskId = if (matchedIndex >= 0) normalizedTaskId else snapshot.recentTaskSummaries.firstOrNull()?.taskId,
                )
            } else {
                resolveTaskRefreshScrollTarget(snapshot).takeIf { it.focusKind != TaskRefreshFocusKind.NONE }
            }
        }

        "running" -> {
            if (snapshot.runningTaskIds.isNotEmpty()) {
                val matchedIndex = snapshot.runningTaskIds.indexOfFirst { it == normalizedTaskId }
                val resolvedIndex = offsets.runningItemsStartIndex ?: 0
                TaskRefreshScrollTarget(
                    index = if (matchedIndex >= 0) resolvedIndex + matchedIndex else resolvedIndex,
                    focusKind = TaskRefreshFocusKind.RUNNING_TASK,
                    taskId = if (matchedIndex >= 0) normalizedTaskId else snapshot.runningTaskIds.firstOrNull(),
                )
            } else {
                resolveTaskRefreshScrollTarget(snapshot).takeIf { it.focusKind != TaskRefreshFocusKind.NONE }
            }
        }

        "queued" -> {
            if (snapshot.queuedTasks.isNotEmpty()) {
                val matchedIndex = snapshot.queuedTasks.indexOfFirst { it.id == normalizedTaskId }
                val resolvedIndex = offsets.queueItemsStartIndex ?: 0
                TaskRefreshScrollTarget(
                    index = if (matchedIndex >= 0) resolvedIndex + matchedIndex else resolvedIndex,
                    focusKind = TaskRefreshFocusKind.QUEUED_TASK,
                    taskId = if (matchedIndex >= 0) normalizedTaskId else snapshot.queuedTasks.firstOrNull()?.id,
                )
            } else {
                resolveTaskRefreshScrollTarget(snapshot).takeIf { it.focusKind != TaskRefreshFocusKind.NONE }
            }
        }

        else -> null
    }
}

internal fun resolveTaskRefreshScrollIndex(snapshot: WorkflowSnapshot): Int {
    return resolveTaskRefreshScrollTarget(snapshot).index
}

internal fun resolveApprovalRefreshScrollTarget(
    focusedApprovalId: String?,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
): ApprovalRefreshScrollTarget {
    if (focusedApprovalId?.isNotBlank() == true) {
        return ApprovalRefreshScrollTarget(index = 1, focusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL)
    }
    if (displayedApprovals.isNotEmpty()) {
        return ApprovalRefreshScrollTarget(index = 1, focusKind = ApprovalRefreshFocusKind.FIRST_APPROVAL)
    }
    return ApprovalRefreshScrollTarget(index = 0, focusKind = ApprovalRefreshFocusKind.NONE)
}

internal fun resolveApprovalRefreshScrollIndex(
    focusedApprovalId: String?,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
): Int {
    return resolveApprovalRefreshScrollTarget(
        focusedApprovalId = focusedApprovalId,
        displayedApprovals = displayedApprovals,
    ).index
}

internal fun resolveRequestedApprovalScrollTarget(
    requestedApprovalId: String?,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
): ApprovalRefreshScrollTarget? {
    val normalizedApprovalId = requestedApprovalId?.trim().orEmpty()
    if (normalizedApprovalId.isBlank()) return null
    return resolveApprovalRefreshScrollTarget(
        focusedApprovalId = normalizedApprovalId,
        displayedApprovals = displayedApprovals,
    )
}

private fun resolveTaskSectionOffsets(snapshot: WorkflowSnapshot): TaskSectionOffsets {
    var nextIndex = 1
    if (snapshot.todos.isNotEmpty()) {
        nextIndex += 1
    }

    val queueItemsStartIndex = if (snapshot.queuedTasks.isNotEmpty()) {
        val startIndex = nextIndex + 1
        nextIndex = startIndex + snapshot.queuedTasks.size
        startIndex
    } else {
        null
    }

    val runningItemsStartIndex = if (snapshot.runningTaskIds.isNotEmpty()) {
        val startIndex = nextIndex + 1
        nextIndex = startIndex + snapshot.runningTaskIds.size
        startIndex
    } else {
        null
    }

    val recentSummaryItemsStartIndex = if (snapshot.recentTaskSummaries.isNotEmpty()) {
        nextIndex + 1
    } else {
        null
    }

    return TaskSectionOffsets(
        queueItemsStartIndex = queueItemsStartIndex,
        runningItemsStartIndex = runningItemsStartIndex,
        recentSummaryItemsStartIndex = recentSummaryItemsStartIndex,
    )
}

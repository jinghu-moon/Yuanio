package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowApprovalSnapshot
import sy.yuanio.app.data.WorkflowSnapshot

internal data class TaskFocusHighlightTarget(
    val latestTaskId: String? = null,
    val runningTaskId: String? = null,
    val queuedTaskId: String? = null,
)

internal fun resolveTaskFocusHighlightTarget(
    snapshot: WorkflowSnapshot,
    focusKind: TaskRefreshFocusKind?,
    preferredTaskId: String? = null,
): TaskFocusHighlightTarget {
    val normalizedTaskId = preferredTaskId?.trim().orEmpty()
    return when (focusKind) {
        TaskRefreshFocusKind.LATEST_SUMMARY -> TaskFocusHighlightTarget(
            latestTaskId = snapshot.recentTaskSummaries.firstOrNull { it.taskId == normalizedTaskId }?.taskId
                ?: snapshot.recentTaskSummaries.firstOrNull()?.taskId,
        )
        TaskRefreshFocusKind.RUNNING_TASK -> TaskFocusHighlightTarget(
            runningTaskId = snapshot.runningTaskIds.firstOrNull { it == normalizedTaskId }
                ?: snapshot.runningTaskIds.firstOrNull(),
        )
        TaskRefreshFocusKind.QUEUED_TASK -> TaskFocusHighlightTarget(
            queuedTaskId = snapshot.queuedTasks.firstOrNull { it.id == normalizedTaskId }?.id
                ?: snapshot.queuedTasks.firstOrNull()?.id,
        )
        else -> TaskFocusHighlightTarget()
    }
}

internal data class ApprovalFocusHighlightTarget(
    val highlightBanner: Boolean = false,
    val approvalId: String? = null,
)

internal fun resolveApprovalFocusHighlightTarget(
    focusedApprovalId: String?,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
    focusKind: ApprovalRefreshFocusKind?,
): ApprovalFocusHighlightTarget {
    return when (focusKind) {
        ApprovalRefreshFocusKind.FOCUSED_APPROVAL -> ApprovalFocusHighlightTarget(
            highlightBanner = true,
            approvalId = displayedApprovals.firstOrNull { it.id == focusedApprovalId }?.id,
        )
        ApprovalRefreshFocusKind.FIRST_APPROVAL -> ApprovalFocusHighlightTarget(
            highlightBanner = false,
            approvalId = displayedApprovals.firstOrNull()?.id,
        )
        else -> ApprovalFocusHighlightTarget()
    }
}

internal data class ApprovalAutoAdvanceTarget(
    val focusedApprovalId: String? = null,
    val focusKind: ApprovalRefreshFocusKind = ApprovalRefreshFocusKind.NONE,
)

internal fun resolveNextApprovalAutoAdvanceTarget(
    currentFocusedApprovalId: String?,
    currentFocusKind: ApprovalRefreshFocusKind,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
    removedApprovalIds: Collection<String>,
): ApprovalAutoAdvanceTarget {
    val removedIds = removedApprovalIds.map { it.trim() }.filter { it.isNotBlank() }.toSet()
    val remainingApprovals = displayedApprovals.filterNot { it.id in removedIds }
    if (remainingApprovals.isEmpty()) {
        return ApprovalAutoAdvanceTarget()
    }

    val normalizedFocusedApprovalId = currentFocusedApprovalId?.trim().orEmpty()
    if (
        currentFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL &&
        normalizedFocusedApprovalId.isNotBlank() &&
        remainingApprovals.any { it.id == normalizedFocusedApprovalId }
    ) {
        return ApprovalAutoAdvanceTarget(
            focusedApprovalId = normalizedFocusedApprovalId,
            focusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
        )
    }

    return ApprovalAutoAdvanceTarget(
        focusedApprovalId = remainingApprovals.firstOrNull()?.id,
        focusKind = if (currentFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL) {
            ApprovalRefreshFocusKind.FOCUSED_APPROVAL
        } else {
            ApprovalRefreshFocusKind.FIRST_APPROVAL
        },
    )
}



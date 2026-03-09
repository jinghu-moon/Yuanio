package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowSnapshot

internal data class ApprovalResultLinkTarget(
    val taskId: String,
)

internal fun resolveApprovalResultLinkTarget(
    handledApprovals: List<WorkflowApprovalSnapshot>,
    snapshot: WorkflowSnapshot,
): ApprovalResultLinkTarget? {
    val taskId = handledApprovals.firstNotNullOfOrNull { approval ->
        approval.taskId?.trim()?.takeIf { it.isNotBlank() }
    } ?: snapshot.recentTaskSummaries.firstOrNull()?.taskId?.trim()?.takeIf { it.isNotBlank() }
    return taskId?.let(::ApprovalResultLinkTarget)
}

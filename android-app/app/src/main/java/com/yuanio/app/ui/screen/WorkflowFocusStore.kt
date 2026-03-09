package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class WorkflowTaskFocusState(
    val kind: TaskRefreshFocusKind = TaskRefreshFocusKind.NONE,
    val taskId: String? = null,
)

internal data class WorkflowApprovalFocusState(
    val kind: ApprovalRefreshFocusKind = ApprovalRefreshFocusKind.NONE,
    val approvalId: String? = null,
)

internal data class WorkflowFocusState(
    val task: WorkflowTaskFocusState = WorkflowTaskFocusState(),
    val approval: WorkflowApprovalFocusState = WorkflowApprovalFocusState(),
)

internal fun resolveTaskWorkflowFocusState(
    snapshot: WorkflowSnapshot,
    focusKind: TaskRefreshFocusKind?,
): WorkflowTaskFocusState {
    val normalizedFocusKind = focusKind ?: TaskRefreshFocusKind.NONE
    if (normalizedFocusKind == TaskRefreshFocusKind.NONE) {
        return WorkflowTaskFocusState()
    }
    val target = resolveTaskFocusHighlightTarget(snapshot, normalizedFocusKind)
    val taskId = target.latestTaskId ?: target.runningTaskId ?: target.queuedTaskId
    return if (taskId.isNullOrBlank()) {
        WorkflowTaskFocusState()
    } else {
        WorkflowTaskFocusState(kind = normalizedFocusKind, taskId = taskId)
    }
}

internal fun resolveApprovalWorkflowFocusState(
    focusedApprovalId: String?,
    displayedApprovals: List<WorkflowApprovalSnapshot>,
    focusKind: ApprovalRefreshFocusKind?,
): WorkflowApprovalFocusState {
    val normalizedFocusKind = focusKind ?: ApprovalRefreshFocusKind.NONE
    if (normalizedFocusKind == ApprovalRefreshFocusKind.NONE) {
        return WorkflowApprovalFocusState()
    }
    val target = resolveApprovalFocusHighlightTarget(
        focusedApprovalId = focusedApprovalId,
        displayedApprovals = displayedApprovals,
        focusKind = normalizedFocusKind,
    )
    return if (target.approvalId.isNullOrBlank()) {
        WorkflowApprovalFocusState()
    } else {
        WorkflowApprovalFocusState(kind = normalizedFocusKind, approvalId = target.approvalId)
    }
}

internal object WorkflowFocusStore {
    private val _state = MutableStateFlow(WorkflowFocusState())
    val state = _state.asStateFlow()

    fun updateTaskFocus(snapshot: WorkflowSnapshot, focusKind: TaskRefreshFocusKind?) {
        _state.value = _state.value.copy(
            task = resolveTaskWorkflowFocusState(snapshot, focusKind),
        )
    }


    fun setTaskFocus(focusKind: TaskRefreshFocusKind?, taskId: String?) {
        val normalizedFocusKind = focusKind ?: TaskRefreshFocusKind.NONE
        val normalizedTaskId = taskId?.trim().orEmpty()
        _state.value = _state.value.copy(
            task = if (normalizedFocusKind == TaskRefreshFocusKind.NONE || normalizedTaskId.isBlank()) {
                WorkflowTaskFocusState()
            } else {
                WorkflowTaskFocusState(kind = normalizedFocusKind, taskId = normalizedTaskId)
            },
        )
    }

    fun updateApprovalFocus(
        focusedApprovalId: String?,
        displayedApprovals: List<WorkflowApprovalSnapshot>,
        focusKind: ApprovalRefreshFocusKind?,
    ) {
        _state.value = _state.value.copy(
            approval = resolveApprovalWorkflowFocusState(
                focusedApprovalId = focusedApprovalId,
                displayedApprovals = displayedApprovals,
                focusKind = focusKind,
            ),
        )
    }

    fun clearTaskFocus() {
        _state.value = _state.value.copy(task = WorkflowTaskFocusState())
    }

    fun clearApprovalFocus() {
        _state.value = _state.value.copy(approval = WorkflowApprovalFocusState())
    }
}

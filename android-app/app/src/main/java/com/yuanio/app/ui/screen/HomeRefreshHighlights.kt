package com.yuanio.app.ui.screen

internal data class HomeRefreshHighlightTargets(
    val highlightTasks: Boolean,
    val highlightApprovals: Boolean,
)

internal fun resolveHomeRefreshHighlightTargets(state: HomeViewModel.UiState): HomeRefreshHighlightTargets {
    val highlightTasks =
        state.runningTaskCount > 0 ||
            state.queuedTaskCount > 0 ||
            state.todoCount > 0 ||
            state.latestTaskSummary != null

    val highlightApprovals =
        state.pendingApprovalCount > 0 ||
            state.firstPendingApproval != null

    return HomeRefreshHighlightTargets(
        highlightTasks = highlightTasks,
        highlightApprovals = highlightApprovals,
    )
}

internal fun resolveHomeTaskFocusPulseKey(state: HomeViewModel.UiState): Long {
    return resolveHomeFocusPulseKey(
        kind = state.focusedTaskKind.name,
        id = state.focusedTaskId,
        enabled = state.focusedTaskKind != TaskRefreshFocusKind.NONE,
    )
}

internal fun resolveHomeApprovalFocusPulseKey(state: HomeViewModel.UiState): Long {
    return resolveHomeFocusPulseKey(
        kind = state.focusedApprovalKind.name,
        id = state.focusedApprovalId,
        enabled = state.focusedApprovalKind != ApprovalRefreshFocusKind.NONE,
    )
}

private fun resolveHomeFocusPulseKey(kind: String, id: String?, enabled: Boolean): Long {
    val normalizedId = id?.trim().orEmpty()
    if (!enabled || normalizedId.isBlank()) return 0L
    val raw = "$kind:$normalizedId".hashCode().toLong() and 0x7fff_ffffL
    return if (raw == 0L) 1L else raw
}

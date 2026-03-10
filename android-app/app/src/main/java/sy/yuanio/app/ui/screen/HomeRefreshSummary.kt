package sy.yuanio.app.ui.screen

internal enum class HomeRefreshSummaryKind {
    EMPTY,
    COUNTS,
}

internal data class HomeRefreshSummary(
    val kind: HomeRefreshSummaryKind,
    val runningTaskCount: Int,
    val queuedTaskCount: Int,
    val pendingApprovalCount: Int,
)

internal fun resolveHomeRefreshSummary(state: HomeViewModel.UiState): HomeRefreshSummary {
    if (state.runningTaskCount <= 0 && state.queuedTaskCount <= 0 && state.pendingApprovalCount <= 0) {
        return HomeRefreshSummary(
            kind = HomeRefreshSummaryKind.EMPTY,
            runningTaskCount = 0,
            queuedTaskCount = 0,
            pendingApprovalCount = 0,
        )
    }
    return HomeRefreshSummary(
        kind = HomeRefreshSummaryKind.COUNTS,
        runningTaskCount = state.runningTaskCount,
        queuedTaskCount = state.queuedTaskCount,
        pendingApprovalCount = state.pendingApprovalCount,
    )
}


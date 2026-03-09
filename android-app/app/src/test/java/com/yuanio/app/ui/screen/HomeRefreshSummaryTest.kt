package com.yuanio.app.ui.screen

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeRefreshSummaryTest {

    @Test
    fun noTasksAndNoApprovalsReturnsEmptySummary() {
        val state = HomeViewModel.UiState(
            runningTaskCount = 0,
            queuedTaskCount = 0,
            pendingApprovalCount = 0,
        )

        val summary = resolveHomeRefreshSummary(state)

        assertEquals(HomeRefreshSummaryKind.EMPTY, summary.kind)
    }

    @Test
    fun taskOrApprovalCountsReturnCountSummary() {
        val state = HomeViewModel.UiState(
            runningTaskCount = 2,
            queuedTaskCount = 3,
            pendingApprovalCount = 1,
        )

        val summary = resolveHomeRefreshSummary(state)

        assertEquals(HomeRefreshSummaryKind.COUNTS, summary.kind)
        assertEquals(2, summary.runningTaskCount)
        assertEquals(3, summary.queuedTaskCount)
        assertEquals(1, summary.pendingApprovalCount)
    }
}

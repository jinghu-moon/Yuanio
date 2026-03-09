package com.yuanio.app.ui.screen

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeRefreshHighlightTargetsTest {

    @Test
    fun emptyHomeDoesNotHighlightAnySummaryCard() {
        val state = HomeViewModel.UiState()

        val targets = resolveHomeRefreshHighlightTargets(state)

        assertEquals(false, targets.highlightTasks)
        assertEquals(false, targets.highlightApprovals)
    }

    @Test
    fun taskSignalHighlightsOnlyTaskCard() {
        val state = HomeViewModel.UiState(todoCount = 2)

        val targets = resolveHomeRefreshHighlightTargets(state)

        assertEquals(true, targets.highlightTasks)
        assertEquals(false, targets.highlightApprovals)
    }

    @Test
    fun approvalSignalHighlightsOnlyApprovalCard() {
        val state = HomeViewModel.UiState(pendingApprovalCount = 1)

        val targets = resolveHomeRefreshHighlightTargets(state)

        assertEquals(false, targets.highlightTasks)
        assertEquals(true, targets.highlightApprovals)
    }

    @Test
    fun taskAndApprovalSignalsHighlightBothCards() {
        val state = HomeViewModel.UiState(
            runningTaskCount = 1,
            pendingApprovalCount = 1,
        )

        val targets = resolveHomeRefreshHighlightTargets(state)

        assertEquals(true, targets.highlightTasks)
        assertEquals(true, targets.highlightApprovals)
    }


    @Test
    fun focusedTaskProducesStableTaskPulseKey() {
        val state = HomeViewModel.UiState(
            focusedTaskId = "task_running_2",
            focusedTaskKind = TaskRefreshFocusKind.RUNNING_TASK,
        )

        val pulseKey = resolveHomeTaskFocusPulseKey(state)

        assertEquals(true, pulseKey > 0L)
    }

    @Test
    fun focusedApprovalProducesStableApprovalPulseKey() {
        val state = HomeViewModel.UiState(
            focusedApprovalId = "ap_2",
            focusedApprovalKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
        )

        val pulseKey = resolveHomeApprovalFocusPulseKey(state)

        assertEquals(true, pulseKey > 0L)
    }

}

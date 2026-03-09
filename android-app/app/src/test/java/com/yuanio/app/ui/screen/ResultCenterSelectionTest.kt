package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowSnapshot
import com.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class ResultCenterSelectionTest {

    @Test
    fun requestedTaskResultUsesExactSummaryWhenPresent() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(
                WorkflowTaskSummary(taskId = "task_1", filesChanged = 1),
                WorkflowTaskSummary(taskId = "task_2", filesChanged = 2),
            ),
        )

        val selection = resolveResultSummarySelection(
            requestedTaskId = "task_2",
            snapshot = snapshot,
        )

        assertEquals("task_2", selection.selectedSummary?.taskId)
        assertEquals(2, selection.selectedSummary?.filesChanged)
        assertEquals(2, selection.summaries.size)
    }

    @Test
    fun missingRequestedTaskFallsBackToLatestSummary() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(
                WorkflowTaskSummary(taskId = "task_latest", filesChanged = 3),
                WorkflowTaskSummary(taskId = "task_old", filesChanged = 1),
            ),
        )

        val selection = resolveResultSummarySelection(
            requestedTaskId = "task_missing",
            snapshot = snapshot,
        )

        assertEquals("task_latest", selection.selectedSummary?.taskId)
    }

    @Test
    fun emptySnapshotReturnsNoSelectedSummary() {
        val selection = resolveResultSummarySelection(
            requestedTaskId = "task_any",
            snapshot = WorkflowSnapshot(),
        )

        assertEquals(null, selection.selectedSummary)
        assertEquals(0, selection.summaries.size)
    }
}

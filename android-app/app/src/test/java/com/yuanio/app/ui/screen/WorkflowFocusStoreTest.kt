package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowQueuedTask
import com.yuanio.app.data.WorkflowSnapshot
import com.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkflowFocusStoreTest {

    @Test
    fun resolveTaskWorkflowFocusStateUsesLatestSummaryWhenRequested() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest")),
            runningTaskIds = listOf("task_running"),
        )

        val state = resolveTaskWorkflowFocusState(snapshot, TaskRefreshFocusKind.LATEST_SUMMARY)

        assertEquals(TaskRefreshFocusKind.LATEST_SUMMARY, state.kind)
        assertEquals("task_latest", state.taskId)
    }

    @Test
    fun resolveTaskWorkflowFocusStateUsesQueuedTaskWhenRequested() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(WorkflowQueuedTask(id = "queued_1", prompt = "queued")),
        )

        val state = resolveTaskWorkflowFocusState(snapshot, TaskRefreshFocusKind.QUEUED_TASK)

        assertEquals(TaskRefreshFocusKind.QUEUED_TASK, state.kind)
        assertEquals("queued_1", state.taskId)
    }

    @Test
    fun setTaskFocusUsesExactTaskIdWhenProvided() {
        WorkflowFocusStore.clearTaskFocus()

        WorkflowFocusStore.setTaskFocus(
            focusKind = TaskRefreshFocusKind.RUNNING_TASK,
            taskId = "task_running_2",
        )

        val state = WorkflowFocusStore.state.value.task
        assertEquals(TaskRefreshFocusKind.RUNNING_TASK, state.kind)
        assertEquals("task_running_2", state.taskId)
    }

    @Test
    fun resolveApprovalWorkflowFocusStateUsesFocusedApprovalWhenMatched() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
            WorkflowApprovalSnapshot(id = "ap_2", desc = "desc2", tool = "Edit"),
        )

        val state = resolveApprovalWorkflowFocusState(
            focusedApprovalId = "ap_2",
            displayedApprovals = approvals,
            focusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
        )

        assertEquals(ApprovalRefreshFocusKind.FOCUSED_APPROVAL, state.kind)
        assertEquals("ap_2", state.approvalId)
    }

    @Test
    fun resolveApprovalWorkflowFocusStateFallsBackToFirstApproval() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
        )

        val state = resolveApprovalWorkflowFocusState(
            focusedApprovalId = null,
            displayedApprovals = approvals,
            focusKind = ApprovalRefreshFocusKind.FIRST_APPROVAL,
        )

        assertEquals(ApprovalRefreshFocusKind.FIRST_APPROVAL, state.kind)
        assertEquals("ap_1", state.approvalId)
    }
}

package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowQueuedTask
import com.yuanio.app.data.WorkflowSnapshot
import com.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkflowRefreshScrollTargetsTest {

    @Test
    fun taskScreenPrefersLatestSummaryTarget() {
        val snapshot = WorkflowSnapshot(
            todos = listOf(),
            queuedTasks = listOf(WorkflowQueuedTask(id = "q1", prompt = "queued")),
            runningTaskIds = listOf("task_running"),
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest")),
        )

        assertEquals(TaskRefreshFocusKind.LATEST_SUMMARY, resolveTaskRefreshScrollTarget(snapshot).focusKind)
        assertEquals(7, resolveTaskRefreshScrollIndex(snapshot))
    }

    @Test
    fun taskScreenFallsBackToRunningTask() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(WorkflowQueuedTask(id = "q1", prompt = "queued")),
            runningTaskIds = listOf("task_running"),
        )

        assertEquals(TaskRefreshFocusKind.RUNNING_TASK, resolveTaskRefreshScrollTarget(snapshot).focusKind)
        assertEquals(5, resolveTaskRefreshScrollIndex(snapshot))
    }

    @Test
    fun taskScreenTargetsFirstQueuedTaskWhenOnlyQueueExists() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(WorkflowQueuedTask(id = "q1", prompt = "queued")),
        )

        assertEquals(TaskRefreshFocusKind.QUEUED_TASK, resolveTaskRefreshScrollTarget(snapshot).focusKind)
        assertEquals(3, resolveTaskRefreshScrollIndex(snapshot))
    }

    @Test
    fun taskScreenReturnsTopWhenNoTaskDataExists() {
        assertEquals(TaskRefreshFocusKind.NONE, resolveTaskRefreshScrollTarget(WorkflowSnapshot()).focusKind)
        assertEquals(0, resolveTaskRefreshScrollIndex(WorkflowSnapshot()))
    }

    @Test
    fun approvalScreenTargetsFocusBannerWhenFocusedApprovalExists() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
        )

        assertEquals(ApprovalRefreshFocusKind.FOCUSED_APPROVAL, resolveApprovalRefreshScrollTarget("ap_1", approvals).focusKind)
        assertEquals(1, resolveApprovalRefreshScrollIndex("ap_1", approvals))
    }

    @Test
    fun approvalScreenTargetsFirstApprovalWhenNoFocusedApprovalExists() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
        )

        assertEquals(ApprovalRefreshFocusKind.FIRST_APPROVAL, resolveApprovalRefreshScrollTarget(null, approvals).focusKind)
        assertEquals(1, resolveApprovalRefreshScrollIndex(null, approvals))
    }

    @Test
    fun approvalScreenReturnsTopWhenNoApprovalDataExists() {
        assertEquals(ApprovalRefreshFocusKind.NONE, resolveApprovalRefreshScrollTarget(null, emptyList()).focusKind)
        assertEquals(0, resolveApprovalRefreshScrollIndex(null, emptyList()))
    }

    @Test
    fun requestedLatestTaskFocusReturnsRequestedScrollTarget() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest")),
        )

        assertEquals(null, resolveRequestedTaskScrollTarget(null, snapshot))
        assertEquals(TaskRefreshFocusKind.LATEST_SUMMARY, resolveRequestedTaskScrollTarget("latest", snapshot)?.focusKind)
    }

    @Test
    fun requestedApprovalFocusReturnsRequestedScrollTarget() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
        )

        assertEquals(null, resolveRequestedApprovalScrollTarget(null, approvals))
        assertEquals(
            ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
            resolveRequestedApprovalScrollTarget("ap_1", approvals)?.focusKind,
        )
    }

    @Test
    fun requestedRunningTaskFocusUsesExactTaskIndex() {
        val snapshot = WorkflowSnapshot(
            runningTaskIds = listOf("task_1", "task_2"),
        )

        val target = resolveRequestedTaskScrollTarget(
            requestedFocus = "running",
            requestedTaskId = "task_2",
            snapshot = snapshot,
        )

        assertEquals(TaskRefreshFocusKind.RUNNING_TASK, target?.focusKind)
        assertEquals(4, target?.index)
    }

    @Test
    fun requestedQueuedTaskFocusUsesExactTaskIndex() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(
                WorkflowQueuedTask(id = "queued_1", prompt = "queued1"),
                WorkflowQueuedTask(id = "queued_2", prompt = "queued2"),
            ),
        )

        val target = resolveRequestedTaskScrollTarget(
            requestedFocus = "queued",
            requestedTaskId = "queued_2",
            snapshot = snapshot,
        )

        assertEquals(TaskRefreshFocusKind.QUEUED_TASK, target?.focusKind)
        assertEquals(4, target?.index)
    }

    @Test
    fun requestedTaskIdWithoutFocusFallsBackToExactRecentTask() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(
                WorkflowTaskSummary(taskId = "task_old"),
                WorkflowTaskSummary(taskId = "task_focus"),
            ),
        )

        val target = resolveRequestedTaskScrollTarget(
            requestedFocus = null,
            requestedTaskId = "task_focus",
            snapshot = snapshot,
        )

        assertEquals(TaskRefreshFocusKind.LATEST_SUMMARY, target?.focusKind)
        assertEquals(4, target?.index)
        assertEquals("task_focus", target?.taskId)
    }

}

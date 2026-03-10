package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowApprovalSnapshot
import sy.yuanio.app.data.WorkflowQueuedTask
import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkflowFocusHighlightTargetsTest {

    @Test
    fun taskLatestFocusHighlightsLatestSummary() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest")),
            runningTaskIds = listOf("task_running"),
            queuedTasks = listOf(WorkflowQueuedTask(id = "queued_1", prompt = "queued")),
        )

        val target = resolveTaskFocusHighlightTarget(snapshot, TaskRefreshFocusKind.LATEST_SUMMARY)

        assertEquals("task_latest", target.latestTaskId)
        assertEquals(null, target.runningTaskId)
        assertEquals(null, target.queuedTaskId)
    }

    @Test
    fun taskRunningFocusHighlightsFirstRunningTask() {
        val snapshot = WorkflowSnapshot(
            runningTaskIds = listOf("task_running", "task_running_2"),
        )

        val target = resolveTaskFocusHighlightTarget(snapshot, TaskRefreshFocusKind.RUNNING_TASK)

        assertEquals(null, target.latestTaskId)
        assertEquals("task_running", target.runningTaskId)
        assertEquals(null, target.queuedTaskId)
    }

    @Test
    fun taskQueuedFocusHighlightsFirstQueuedTask() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(WorkflowQueuedTask(id = "queued_1", prompt = "queued")),
        )

        val target = resolveTaskFocusHighlightTarget(snapshot, TaskRefreshFocusKind.QUEUED_TASK)

        assertEquals(null, target.latestTaskId)
        assertEquals(null, target.runningTaskId)
        assertEquals("queued_1", target.queuedTaskId)
    }

    @Test
    fun taskRunningFocusHonorsExplicitTaskId() {
        val snapshot = WorkflowSnapshot(
            runningTaskIds = listOf("task_running_1", "task_running_2"),
        )

        val target = resolveTaskFocusHighlightTarget(
            snapshot = snapshot,
            focusKind = TaskRefreshFocusKind.RUNNING_TASK,
            preferredTaskId = "task_running_2",
        )

        assertEquals("task_running_2", target.runningTaskId)
    }

    @Test
    fun taskQueuedFocusHonorsExplicitTaskId() {
        val snapshot = WorkflowSnapshot(
            queuedTasks = listOf(
                WorkflowQueuedTask(id = "queued_1", prompt = "queued"),
                WorkflowQueuedTask(id = "queued_2", prompt = "queued2"),
            ),
        )

        val target = resolveTaskFocusHighlightTarget(
            snapshot = snapshot,
            focusKind = TaskRefreshFocusKind.QUEUED_TASK,
            preferredTaskId = "queued_2",
        )

        assertEquals("queued_2", target.queuedTaskId)
    }

    @Test
    fun approvalFocusedTargetHighlightsBannerAndMatchedApproval() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
            WorkflowApprovalSnapshot(id = "ap_2", desc = "desc2", tool = "Edit"),
        )

        val target = resolveApprovalFocusHighlightTarget(
            focusedApprovalId = "ap_2",
            displayedApprovals = approvals,
            focusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
        )

        assertEquals(true, target.highlightBanner)
        assertEquals("ap_2", target.approvalId)
    }

    @Test
    fun approvalFirstTargetHighlightsOnlyFirstApprovalCard() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc", tool = "Edit"),
        )

        val target = resolveApprovalFocusHighlightTarget(
            focusedApprovalId = null,
            displayedApprovals = approvals,
            focusKind = ApprovalRefreshFocusKind.FIRST_APPROVAL,
        )

        assertEquals(false, target.highlightBanner)
        assertEquals("ap_1", target.approvalId)
    }


    @Test
    fun focusedApprovalRemovalAdvancesToNextFocusedApproval() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc1", tool = "Edit"),
            WorkflowApprovalSnapshot(id = "ap_2", desc = "desc2", tool = "Edit"),
        )

        val target = resolveNextApprovalAutoAdvanceTarget(
            currentFocusedApprovalId = "ap_1",
            currentFocusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
            displayedApprovals = approvals,
            removedApprovalIds = listOf("ap_1"),
        )

        assertEquals("ap_2", target.focusedApprovalId)
        assertEquals(ApprovalRefreshFocusKind.FOCUSED_APPROVAL, target.focusKind)
    }

    @Test
    fun unrelatedApprovalRemovalPreservesCurrentFocus() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc1", tool = "Edit"),
            WorkflowApprovalSnapshot(id = "ap_2", desc = "desc2", tool = "Edit"),
        )

        val target = resolveNextApprovalAutoAdvanceTarget(
            currentFocusedApprovalId = "ap_2",
            currentFocusKind = ApprovalRefreshFocusKind.FOCUSED_APPROVAL,
            displayedApprovals = approvals,
            removedApprovalIds = listOf("ap_1"),
        )

        assertEquals("ap_2", target.focusedApprovalId)
        assertEquals(ApprovalRefreshFocusKind.FOCUSED_APPROVAL, target.focusKind)
    }

    @Test
    fun nonFocusedBatchRemovalFallsBackToFirstRemainingApproval() {
        val approvals = listOf(
            WorkflowApprovalSnapshot(id = "ap_1", desc = "desc1", tool = "Edit"),
            WorkflowApprovalSnapshot(id = "ap_2", desc = "desc2", tool = "Edit"),
        )

        val target = resolveNextApprovalAutoAdvanceTarget(
            currentFocusedApprovalId = null,
            currentFocusKind = ApprovalRefreshFocusKind.NONE,
            displayedApprovals = approvals,
            removedApprovalIds = listOf("ap_1"),
        )

        assertEquals("ap_2", target.focusedApprovalId)
        assertEquals(ApprovalRefreshFocusKind.FIRST_APPROVAL, target.focusKind)
    }

}


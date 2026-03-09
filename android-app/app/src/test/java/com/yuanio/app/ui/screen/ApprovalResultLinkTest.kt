package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowApprovalSnapshot
import com.yuanio.app.data.WorkflowSnapshot
import com.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApprovalResultLinkTest {
    @Test
    fun `handled approval uses its taskId when present`() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest"))
        )
        val handled = listOf(
            WorkflowApprovalSnapshot(id = "apv_1", desc = "Approve", tool = "Edit", taskId = "task_123")
        )

        val target = resolveApprovalResultLinkTarget(handled, snapshot)

        assertEquals("task_123", target?.taskId)
    }

    @Test
    fun `handled approval falls back to latest summary taskId`() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest"))
        )
        val handled = listOf(
            WorkflowApprovalSnapshot(id = "apv_1", desc = "Approve", tool = "Edit", taskId = null)
        )

        val target = resolveApprovalResultLinkTarget(handled, snapshot)

        assertEquals("task_latest", target?.taskId)
    }

    @Test
    fun `batch handled approvals prefer first taskId`() {
        val snapshot = WorkflowSnapshot(
            recentTaskSummaries = listOf(WorkflowTaskSummary(taskId = "task_latest"))
        )
        val handled = listOf(
            WorkflowApprovalSnapshot(id = "apv_1", desc = "Approve", tool = "Edit", taskId = "task_first"),
            WorkflowApprovalSnapshot(id = "apv_2", desc = "Approve", tool = "Edit", taskId = "task_second")
        )

        val target = resolveApprovalResultLinkTarget(handled, snapshot)

        assertEquals("task_first", target?.taskId)
    }

    @Test
    fun `no approval and no summary returns null`() {
        val target = resolveApprovalResultLinkTarget(
            handledApprovals = emptyList(),
            snapshot = WorkflowSnapshot(),
        )

        assertNull(target)
    }
}

package com.yuanio.app.ui.screen

import com.yuanio.app.data.WorkflowSnapshot
import com.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HomeResultSelectionTest {
    @Test
    fun `focused task opens focused result`() {
        val target = resolveHomeResultTaskId(
            focusedTaskId = "task_focus",
            latestResultSummary = WorkflowTaskSummary(taskId = "task_latest"),
        )

        assertEquals("task_focus", target)
    }

    @Test
    fun `latest summary opens latest result`() {
        val target = resolveHomeResultTaskId(
            focusedTaskId = null,
            latestResultSummary = WorkflowTaskSummary(taskId = "task_latest"),
        )

        assertEquals("task_latest", target)
    }

    @Test
    fun `empty state returns null`() {
        val target = resolveHomeResultTaskId(
            focusedTaskId = null,
            latestResultSummary = null,
        )

        assertNull(target)
    }
}

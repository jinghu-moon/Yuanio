package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskSummarySectionsTest {
    @Test
    fun `requested summary is pinned and removed from recent list`() {
        val sections = splitTaskSummariesForDisplay(
            summaries = listOf(
                WorkflowTaskSummary(taskId = "task_a"),
                WorkflowTaskSummary(taskId = "task_b"),
                WorkflowTaskSummary(taskId = "task_c"),
            ),
            pinnedTaskIds = listOf("task_b"),
        )

        assertEquals(listOf("task_b"), sections.pinned.map { it.taskId })
        assertEquals(listOf("task_a", "task_c"), sections.recent.map { it.taskId })
    }

    @Test
    fun `requested and focused summaries are pinned in stable order without duplicates`() {
        val sections = splitTaskSummariesForDisplay(
            summaries = listOf(
                WorkflowTaskSummary(taskId = "task_a"),
                WorkflowTaskSummary(taskId = "task_b"),
                WorkflowTaskSummary(taskId = "task_c"),
            ),
            pinnedTaskIds = listOf("task_c", "task_c", "task_a"),
        )

        assertEquals(listOf("task_c", "task_a"), sections.pinned.map { it.taskId })
        assertEquals(listOf("task_b"), sections.recent.map { it.taskId })
    }

    @Test
    fun `unknown pinned ids keep recent list unchanged`() {
        val sections = splitTaskSummariesForDisplay(
            summaries = listOf(
                WorkflowTaskSummary(taskId = "task_a"),
                WorkflowTaskSummary(taskId = "task_b"),
            ),
            pinnedTaskIds = listOf("task_missing"),
        )

        assertEquals(emptyList<String>(), sections.pinned.map { it.taskId })
        assertEquals(listOf("task_a", "task_b"), sections.recent.map { it.taskId })
    }
}


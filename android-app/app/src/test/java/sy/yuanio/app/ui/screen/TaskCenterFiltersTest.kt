package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.TodoItem
import sy.yuanio.app.data.WorkflowQueuedTask
import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskCenterFiltersTest {
    @Test
    fun `all filter keeps all sections when query empty`() {
        val snapshot = sampleSnapshot()

        val result = filterTaskCenterSnapshot(snapshot, query = "", mode = TaskCenterFilterMode.ALL)

        assertEquals(2, result.queuedTasks.size)
        assertEquals(2, result.runningTaskIds.size)
        assertEquals(2, result.recentTaskSummaries.size)
        assertEquals(1, result.todos.size)
    }

    @Test
    fun `query filters across queue running summary and todos`() {
        val snapshot = sampleSnapshot()

        val result = filterTaskCenterSnapshot(snapshot, query = "lint", mode = TaskCenterFilterMode.ALL)

        assertEquals(listOf("task_queue_lint"), result.queuedTasks.map { it.id })
        assertEquals(listOf("task_running_lint"), result.runningTaskIds)
        assertEquals(listOf("task_summary_lint"), result.recentTaskSummaries.map { it.taskId })
        assertEquals(listOf("Run lint fix"), result.todos.map { it.content })
    }

    @Test
    fun `running filter keeps only running section`() {
        val result = filterTaskCenterSnapshot(sampleSnapshot(), query = "", mode = TaskCenterFilterMode.RUNNING)

        assertEquals(emptyList<WorkflowQueuedTask>(), result.queuedTasks)
        assertEquals(2, result.runningTaskIds.size)
        assertEquals(emptyList<WorkflowTaskSummary>(), result.recentTaskSummaries)
    }

    @Test
    fun `query also matches task chat preview summaries`() {
        val snapshot = sampleSnapshot()

        val result = filterTaskCenterSnapshot(
            snapshot = snapshot,
            query = "refactor pipeline",
            mode = TaskCenterFilterMode.ALL,
            taskChatPreviewMap = mapOf(
                "task_queue_build" to TaskChatActivityEntry(
                    taskId = "task_queue_build",
                    role = "ai",
                    summary = "refactor pipeline before apk build",
                    ts = 10L,
                ),
            ),
        )

        assertEquals(listOf("task_queue_build"), result.queuedTasks.map { it.id })
        assertEquals(emptyList<String>(), result.runningTaskIds)
        assertEquals(emptyList<WorkflowTaskSummary>(), result.recentTaskSummaries)
    }

    private fun sampleSnapshot(): WorkflowSnapshot {
        return WorkflowSnapshot(
            queuedTasks = listOf(
                WorkflowQueuedTask(id = "task_queue_build", prompt = "build apk"),
                WorkflowQueuedTask(id = "task_queue_lint", prompt = "lint repo"),
            ),
            runningTaskIds = listOf("task_running_build", "task_running_lint"),
            recentTaskSummaries = listOf(
                WorkflowTaskSummary(taskId = "task_summary_test", gitStat = "tests changed"),
                WorkflowTaskSummary(taskId = "task_summary_lint", gitStat = "lint fixes"),
            ),
            todos = listOf(TodoItem(id = "todo_1", content = "Run lint fix", status = "pending", priority = "medium")),
        )
    }
}


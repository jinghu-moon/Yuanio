package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.WorkflowQueuedTask
import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowTaskSummary

internal enum class TaskCenterFilterMode {
    ALL,
    RUNNING,
    QUEUED,
    RECENT,
}

internal fun filterTaskCenterSnapshot(
    snapshot: WorkflowSnapshot,
    query: String,
    mode: TaskCenterFilterMode,
    taskChatPreviewMap: Map<String, TaskChatActivityEntry> = emptyMap(),
): WorkflowSnapshot {
    val normalizedQuery = query.trim().lowercase()
    val queuedTasks = snapshot.queuedTasks.filter {
        matchesTaskQuery(
            query = normalizedQuery,
            values = listOf(it.id, it.prompt, it.agent.orEmpty(), taskChatPreviewMap[it.id]?.summary.orEmpty()),
        )
    }
    val runningTaskIds = snapshot.runningTaskIds.filter {
        matchesTaskQuery(normalizedQuery, listOf(it, taskChatPreviewMap[it]?.summary.orEmpty()))
    }
    val recentTaskSummaries = snapshot.recentTaskSummaries.filter {
        matchesTaskQuery(
            query = normalizedQuery,
            values = listOf(
                it.taskId,
                it.gitStat,
                it.filesChanged.toString(),
                it.totalTokens.toString(),
                taskChatPreviewMap[it.taskId]?.summary.orEmpty(),
            ),
        )
    }
    val todos = snapshot.todos.filter {
        matchesTaskQuery(
            query = normalizedQuery,
            values = listOf(it.id, it.content, it.status, it.priority),
        )
    }
    return when (mode) {
        TaskCenterFilterMode.ALL -> snapshot.copy(
            queuedTasks = queuedTasks,
            runningTaskIds = runningTaskIds,
            recentTaskSummaries = recentTaskSummaries,
            todos = todos,
        )
        TaskCenterFilterMode.RUNNING -> snapshot.copy(
            queuedTasks = emptyList(),
            runningTaskIds = runningTaskIds,
            recentTaskSummaries = emptyList(),
            todos = emptyList(),
        )
        TaskCenterFilterMode.QUEUED -> snapshot.copy(
            queuedTasks = queuedTasks,
            runningTaskIds = emptyList(),
            recentTaskSummaries = emptyList(),
            todos = emptyList(),
        )
        TaskCenterFilterMode.RECENT -> snapshot.copy(
            queuedTasks = emptyList(),
            runningTaskIds = emptyList(),
            recentTaskSummaries = recentTaskSummaries,
            todos = emptyList(),
        )
    }
}

private fun matchesTaskQuery(query: String, values: List<String>): Boolean {
    if (query.isBlank()) return true
    return values.any { it.lowercase().contains(query) }
}


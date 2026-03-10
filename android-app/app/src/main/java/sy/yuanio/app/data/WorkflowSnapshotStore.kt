package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import sy.yuanio.app.ui.model.ChatItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

data class WorkflowQueuedTask(
    val id: String,
    val prompt: String,
    val agent: String? = null,
    val priority: Int = 0,
    val createdAt: Long = 0L,
)

data class WorkflowTaskSummary(
    val taskId: String,
    val durationMs: Long = 0L,
    val gitStat: String = "",
    val filesChanged: Int = 0,
    val insertions: Int = 0,
    val deletions: Int = 0,
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val cacheCreationTokens: Int = 0,
    val cacheReadTokens: Int = 0,
    val updatedAt: Long = 0L,
) {
    val totalTokens: Int
        get() = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
}

data class WorkflowApprovalSnapshot(
    val id: String,
    val desc: String,
    val tool: String,
    val files: List<String> = emptyList(),
    val riskLevel: String = "medium",
    val riskSummary: String = "",
    val diffHighlights: List<String> = emptyList(),
    val preview: String? = null,
    val context: String? = null,
    val permissionMode: String? = null,
    val taskId: String? = null,
    val agent: String? = null,
    val updatedAt: Long = 0L,
) {
    fun toChatItem(): ChatItem.Approval {
        return ChatItem.Approval(
            id = id,
            desc = desc,
            tool = tool,
            files = files,
            riskLevel = riskLevel,
            riskSummary = riskSummary,
            diffHighlights = diffHighlights,
            preview = preview,
            context = context,
            permissionMode = permissionMode,
            taskId = taskId,
            agent = agent,
        )
    }

    companion object {
        fun fromChatItem(item: ChatItem.Approval): WorkflowApprovalSnapshot {
            return WorkflowApprovalSnapshot(
                id = item.id,
                desc = item.desc,
                tool = item.tool,
                files = item.files,
                riskLevel = item.riskLevel,
                riskSummary = item.riskSummary,
                diffHighlights = item.diffHighlights,
                preview = item.preview,
                context = item.context,
                permissionMode = item.permissionMode,
                taskId = item.taskId,
                agent = item.agent,
                updatedAt = System.currentTimeMillis(),
            )
        }
    }
}

data class WorkflowSnapshot(
    val sessionId: String? = null,
    val runningTaskCount: Int = 0,
    val pendingApprovalCount: Int = 0,
    val queuedTaskCount: Int = 0,
    val queueMode: String = "sequential",
    val activeApprovalId: String? = null,
    val riskLevel: String? = null,
    val riskSummary: String = "",
    val queuedTasks: List<WorkflowQueuedTask> = emptyList(),
    val runningTaskIds: List<String> = emptyList(),
    val recentTaskSummaries: List<WorkflowTaskSummary> = emptyList(),
    val pendingApprovals: List<WorkflowApprovalSnapshot> = emptyList(),
    val todos: List<TodoItem> = emptyList(),
    val updatedAt: Long = 0L,
)

object WorkflowSnapshotStore {
    private const val PREFS_NAME = "yuanio_workflow_snapshot"
    private const val KEY_SNAPSHOT = "snapshot"
    private const val MAX_RECENT_SUMMARIES = 8

    private var prefs: SharedPreferences? = null

    private val _snapshot = MutableStateFlow(WorkflowSnapshot())
    val snapshot = _snapshot.asStateFlow()

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        _snapshot.value = readSnapshot()
    }

    fun syncConversationState(
        sessionId: String?,
        runningTaskCount: Int,
        pendingApprovalCount: Int,
        activeApprovalId: String?,
        riskLevel: String?,
        riskSummary: String,
        pendingApprovals: List<ChatItem.Approval>,
        todos: List<TodoItem>,
    ) {
        mutate { current ->
            current.copy(
                sessionId = sessionId ?: current.sessionId,
                runningTaskCount = max(runningTaskCount, current.runningTaskIds.size),
                pendingApprovalCount = pendingApprovalCount.coerceAtLeast(0),
                activeApprovalId = activeApprovalId,
                riskLevel = riskLevel,
                riskSummary = riskSummary,
                pendingApprovals = pendingApprovals.map(WorkflowApprovalSnapshot::fromChatItem),
                todos = todos,
            )
        }
    }

    fun syncTaskQueueStatus(
        queuedTasks: List<WorkflowQueuedTask>,
        runningTaskIds: List<String>,
        queueMode: String,
    ) {
        mutate { current ->
            current.copy(
                queuedTaskCount = queuedTasks.size,
                queuedTasks = queuedTasks,
                runningTaskIds = runningTaskIds,
                runningTaskCount = runningTaskIds.size,
                queueMode = queueMode,
            )
        }
    }

    fun upsertTaskSummary(summary: WorkflowTaskSummary) {
        mutate { current ->
            val merged = current.recentTaskSummaries
                .filterNot { it.taskId == summary.taskId }
                .toMutableList()
                .apply { add(0, summary.copy(updatedAt = summary.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis())) }
                .take(MAX_RECENT_SUMMARIES)
            current.copy(recentTaskSummaries = merged)
        }
    }

    fun upsertTaskUsage(
        taskId: String,
        inputTokens: Int,
        outputTokens: Int,
        cacheCreationTokens: Int,
        cacheReadTokens: Int,
    ) {
        if (taskId.isBlank()) return
        mutate { current ->
            val now = System.currentTimeMillis()
            val index = current.recentTaskSummaries.indexOfFirst { it.taskId == taskId }
            val updated = current.recentTaskSummaries.toMutableList()
            val nextSummary = if (index >= 0) {
                updated[index].copy(
                    inputTokens = inputTokens,
                    outputTokens = outputTokens,
                    cacheCreationTokens = cacheCreationTokens,
                    cacheReadTokens = cacheReadTokens,
                    updatedAt = now,
                )
            } else {
                WorkflowTaskSummary(
                    taskId = taskId,
                    inputTokens = inputTokens,
                    outputTokens = outputTokens,
                    cacheCreationTokens = cacheCreationTokens,
                    cacheReadTokens = cacheReadTokens,
                    updatedAt = now,
                )
            }
            if (index >= 0) {
                updated[index] = nextSummary
                current.copy(recentTaskSummaries = updated.sortedByDescending { it.updatedAt }.take(MAX_RECENT_SUMMARIES))
            } else {
                current.copy(recentTaskSummaries = listOf(nextSummary) + updated.take(MAX_RECENT_SUMMARIES - 1))
            }
        }
    }

    fun removeApproval(approvalId: String) {
        if (approvalId.isBlank()) return
        mutate { current ->
            val nextApprovals = current.pendingApprovals.filterNot { it.id == approvalId }
            current.copy(
                pendingApprovals = nextApprovals,
                pendingApprovalCount = (current.pendingApprovalCount - 1).coerceAtLeast(0),
                activeApprovalId = current.activeApprovalId?.takeUnless { it == approvalId },
                riskLevel = if (current.activeApprovalId == approvalId) null else current.riskLevel,
                riskSummary = if (current.activeApprovalId == approvalId) "" else current.riskSummary,
            )
        }
    }

    fun removeApprovals(approvalIds: Collection<String>) {
        val uniqueIds = approvalIds.map { it.trim() }.filter { it.isNotBlank() }.toSet()
        if (uniqueIds.isEmpty()) return
        mutate { current ->
            val removedCount = current.pendingApprovals.count { it.id in uniqueIds }
            val nextApprovals = current.pendingApprovals.filterNot { it.id in uniqueIds }
            current.copy(
                pendingApprovals = nextApprovals,
                pendingApprovalCount = (current.pendingApprovalCount - removedCount).coerceAtLeast(0),
                activeApprovalId = current.activeApprovalId?.takeUnless { it in uniqueIds },
                riskLevel = if (current.activeApprovalId in uniqueIds) null else current.riskLevel,
                riskSummary = if (current.activeApprovalId in uniqueIds) "" else current.riskSummary,
            )
        }
    }

    private inline fun mutate(transform: (WorkflowSnapshot) -> WorkflowSnapshot) {
        val next = transform(_snapshot.value).withUpdatedAt()
        _snapshot.value = next
        persist(next)
    }

    private fun WorkflowSnapshot.withUpdatedAt(): WorkflowSnapshot {
        return copy(updatedAt = System.currentTimeMillis())
    }

    private fun persist(snapshot: WorkflowSnapshot) {
        prefs?.edit()?.putString(KEY_SNAPSHOT, encodeSnapshot(snapshot))?.apply()
    }

    private fun readSnapshot(): WorkflowSnapshot {
        val raw = prefs?.getString(KEY_SNAPSHOT, null) ?: return _snapshot.value
        return runCatching { decodeSnapshot(raw) }.getOrElse { WorkflowSnapshot() }
    }

    private fun encodeSnapshot(snapshot: WorkflowSnapshot): String {
        return JSONObject()
            .put("sessionId", snapshot.sessionId)
            .put("runningTaskCount", snapshot.runningTaskCount)
            .put("pendingApprovalCount", snapshot.pendingApprovalCount)
            .put("queuedTaskCount", snapshot.queuedTaskCount)
            .put("queueMode", snapshot.queueMode)
            .put("activeApprovalId", snapshot.activeApprovalId)
            .put("riskLevel", snapshot.riskLevel)
            .put("riskSummary", snapshot.riskSummary)
            .put("queuedTasks", JSONArray().apply {
                snapshot.queuedTasks.forEach { task ->
                    put(
                        JSONObject()
                            .put("id", task.id)
                            .put("prompt", task.prompt)
                            .put("agent", task.agent)
                            .put("priority", task.priority)
                            .put("createdAt", task.createdAt)
                    )
                }
            })
            .put("runningTaskIds", JSONArray(snapshot.runningTaskIds))
            .put("recentTaskSummaries", JSONArray().apply {
                snapshot.recentTaskSummaries.forEach { summary ->
                    put(
                        JSONObject()
                            .put("taskId", summary.taskId)
                            .put("durationMs", summary.durationMs)
                            .put("gitStat", summary.gitStat)
                            .put("filesChanged", summary.filesChanged)
                            .put("insertions", summary.insertions)
                            .put("deletions", summary.deletions)
                            .put("inputTokens", summary.inputTokens)
                            .put("outputTokens", summary.outputTokens)
                            .put("cacheCreationTokens", summary.cacheCreationTokens)
                            .put("cacheReadTokens", summary.cacheReadTokens)
                            .put("updatedAt", summary.updatedAt)
                    )
                }
            })
            .put("pendingApprovals", JSONArray().apply {
                snapshot.pendingApprovals.forEach { approval ->
                    put(
                        JSONObject()
                            .put("id", approval.id)
                            .put("desc", approval.desc)
                            .put("tool", approval.tool)
                            .put("files", JSONArray(approval.files))
                            .put("riskLevel", approval.riskLevel)
                            .put("riskSummary", approval.riskSummary)
                            .put("diffHighlights", JSONArray(approval.diffHighlights))
                            .put("preview", approval.preview)
                            .put("context", approval.context)
                            .put("permissionMode", approval.permissionMode)
                            .put("taskId", approval.taskId)
                            .put("agent", approval.agent)
                            .put("updatedAt", approval.updatedAt)
                    )
                }
            })
            .put("todos", JSONArray().apply {
                snapshot.todos.forEach { todo ->
                    put(
                        JSONObject()
                            .put("id", todo.id)
                            .put("content", todo.content)
                            .put("status", todo.status)
                            .put("priority", todo.priority)
                    )
                }
            })
            .put("updatedAt", snapshot.updatedAt)
            .toString()
    }

    private fun decodeSnapshot(raw: String): WorkflowSnapshot {
        val json = JSONObject(raw)
        return WorkflowSnapshot(
            sessionId = json.optString("sessionId").takeIf { it.isNotBlank() },
            runningTaskCount = json.optInt("runningTaskCount", 0),
            pendingApprovalCount = json.optInt("pendingApprovalCount", 0),
            queuedTaskCount = json.optInt("queuedTaskCount", 0),
            queueMode = json.optString("queueMode", "sequential"),
            activeApprovalId = json.optString("activeApprovalId").takeIf { it.isNotBlank() },
            riskLevel = json.optString("riskLevel").takeIf { it.isNotBlank() },
            riskSummary = json.optString("riskSummary", ""),
            queuedTasks = json.optJSONArray("queuedTasks").toQueuedTasks(),
            runningTaskIds = json.optJSONArray("runningTaskIds").toStringList(),
            recentTaskSummaries = json.optJSONArray("recentTaskSummaries").toTaskSummaries(),
            pendingApprovals = json.optJSONArray("pendingApprovals").toApprovals(),
            todos = json.optJSONArray("todos").toTodos(),
            updatedAt = json.optLong("updatedAt", 0L),
        )
    }

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                optString(index).takeIf { it.isNotBlank() }?.let(::add)
            }
        }
    }

    private fun JSONArray?.toQueuedTasks(): List<WorkflowQueuedTask> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val prompt = item.optString("prompt").trim()
                if (id.isBlank() || prompt.isBlank()) continue
                add(
                    WorkflowQueuedTask(
                        id = id,
                        prompt = prompt,
                        agent = item.optString("agent").takeIf { it.isNotBlank() },
                        priority = item.optInt("priority", 0),
                        createdAt = item.optLong("createdAt", 0L),
                    )
                )
            }
        }
    }

    private fun JSONArray?.toTaskSummaries(): List<WorkflowTaskSummary> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val taskId = item.optString("taskId").trim()
                if (taskId.isBlank()) continue
                add(
                    WorkflowTaskSummary(
                        taskId = taskId,
                        durationMs = item.optLong("durationMs", 0L),
                        gitStat = item.optString("gitStat", ""),
                        filesChanged = item.optInt("filesChanged", 0),
                        insertions = item.optInt("insertions", 0),
                        deletions = item.optInt("deletions", 0),
                        inputTokens = item.optInt("inputTokens", 0),
                        outputTokens = item.optInt("outputTokens", 0),
                        cacheCreationTokens = item.optInt("cacheCreationTokens", 0),
                        cacheReadTokens = item.optInt("cacheReadTokens", 0),
                        updatedAt = item.optLong("updatedAt", 0L),
                    )
                )
            }
        }
    }

    private fun JSONArray?.toApprovals(): List<WorkflowApprovalSnapshot> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val desc = item.optString("desc").trim()
                val tool = item.optString("tool").trim()
                if (id.isBlank() || desc.isBlank() || tool.isBlank()) continue
                add(
                    WorkflowApprovalSnapshot(
                        id = id,
                        desc = desc,
                        tool = tool,
                        files = item.optJSONArray("files").toStringList(),
                        riskLevel = item.optString("riskLevel", "medium"),
                        riskSummary = item.optString("riskSummary", ""),
                        diffHighlights = item.optJSONArray("diffHighlights").toStringList(),
                        preview = item.optString("preview").takeIf { it.isNotBlank() },
                        context = item.optString("context").takeIf { it.isNotBlank() },
                        permissionMode = item.optString("permissionMode").takeIf { it.isNotBlank() },
                        taskId = item.optString("taskId").takeIf { it.isNotBlank() },
                        agent = item.optString("agent").takeIf { it.isNotBlank() },
                        updatedAt = item.optLong("updatedAt", 0L),
                    )
                )
            }
        }
    }

    private fun JSONArray?.toTodos(): List<TodoItem> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val content = item.optString("content").trim()
                if (content.isBlank()) continue
                add(
                    TodoItem(
                        id = id,
                        content = content,
                        status = item.optString("status", "pending"),
                        priority = item.optString("priority", "medium"),
                    )
                )
            }
        }
    }
}


package com.yuanio.app.data

import com.yuanio.app.ui.model.ChatItem
import org.json.JSONArray
import org.json.JSONObject

data class AgentParseContext(
    val envelopeId: String? = null,
    val fallbackAgent: String? = null,
    val currentStatus: String? = null,
    val currentProjectPath: String? = null,
    val currentRunningTasks: Int? = null,
    val currentPendingApprovals: Int? = null,
    val currentTurnVersion: Int? = null,
    val currentTurnReason: String? = null,
    val currentPermissionMode: String? = null,
    val currentModelMode: String? = null,
)

sealed interface ParsedAgentEvent {
    data class StreamChunk(val text: String) : ParsedAgentEvent
    data class StreamEnd(val finalText: String?) : ParsedAgentEvent
    data class TerminalOutput(val text: String) : ParsedAgentEvent
    data class Thinking(val item: ChatItem.Thinking, val done: Boolean) : ParsedAgentEvent
    data class ToolCall(val item: ChatItem.ToolCall, val paramsSummary: String) : ParsedAgentEvent
    data class UsageReport(val item: ChatItem.UsageInfo, val cumulative: Boolean) : ParsedAgentEvent
    data class FileDiff(val item: ChatItem.FileDiff) : ParsedAgentEvent
    data class DiffActionResult(
        val path: String,
        val action: String,
        val success: Boolean,
        val error: String?,
    ) : ParsedAgentEvent

    data class StatusUpdate(
        val status: String,
        val projectPath: String?,
        val runningTasks: Int,
        val pendingApprovals: Int,
        val reason: String,
        val version: Int,
        val updatedAt: Long,
    ) : ParsedAgentEvent

    data class RunningTask(val taskId: String, val agent: String)

    data class HeartbeatUpdate(
        val status: String,
        val uptime: Int,
        val projectPath: String?,
        val agent: String,
        val runningTasks: List<RunningTask>,
        val permissionMode: String,
        val metadataVersion: Int,
        val modelMode: String,
        val turnStateVersion: Int,
        val turnStateReason: String,
    ) : ParsedAgentEvent

    data class TurnStateUpdate(
        val phase: String,
        val version: Int,
        val reason: String,
        val updatedAt: Long,
        val runningTasks: Int,
        val pendingApprovals: Int,
    ) : ParsedAgentEvent

    data class InteractionStateUpdate(
        val phase: String,
        val version: Int,
        val reason: String,
        val updatedAt: Long,
        val runningTasks: Int,
        val pendingApprovals: Int,
        val availableActions: List<String>,
        val activeApprovalId: String?,
        val riskLevel: String?,
        val riskSummary: String,
        val diffHighlights: List<String>,
        val lastError: String,
    ) : ParsedAgentEvent

    data class ReplayDone(
        val sessionId: String,
        val replayed: Int,
        val daemonCached: Int,
        val rounds: Int,
        val reason: String,
        val at: Long,
    ) : ParsedAgentEvent

    data class ForegroundProbeAck(
        val probeId: String?,
        val clientTs: Long,
        val serverTs: Long,
        val sessionId: String,
        val status: String,
        val cwd: String?,
        val turnStateVersion: Int,
        val turnStateReason: String,
        val runningTasks: Int,
        val pendingApprovals: Int,
        val permissionMode: String,
        val modelMode: String,
    ) : ParsedAgentEvent

    data class HookEvent(val item: ChatItem.HookEvent) : ParsedAgentEvent
    data class ApprovalRequest(val item: ChatItem.Approval) : ParsedAgentEvent
    data class TodoUpdate(val item: ChatItem.TodoUpdate) : ParsedAgentEvent
    data class ModelModeUpdate(val modeValue: String) : ParsedAgentEvent
}

class AgentEventParser {
    fun parse(
        type: String,
        payload: String,
        context: AgentParseContext = AgentParseContext(),
    ): ParsedAgentEvent? = runCatching {
        when (type) {
            "stream_chunk" -> ParsedAgentEvent.StreamChunk(payload)
            "stream_end" -> parseStreamEnd(payload)
            "terminal_output" -> ParsedAgentEvent.TerminalOutput(payload)
            "thinking" -> parseThinking(payload, context)
            "tool_call" -> parseToolCall(payload, context)
            "usage_report" -> parseUsageReport(payload, context)
            "file_diff" -> parseFileDiff(payload, context)
            "diff_action_result" -> parseDiffActionResult(payload)
            "status" -> parseStatus(payload, context)
            "heartbeat" -> parseHeartbeat(payload, context)
            "turn_state" -> parseTurnState(payload, context)
            "interaction_state" -> parseInteractionState(payload, context)
            "replay_done" -> parseReplayDone(payload)
            "foreground_probe_ack" -> parseForegroundProbeAck(payload, context)
            "hook_event" -> parseHookEvent(payload, context)
            "approval_req" -> parseApproval(payload, context)
            "todo_update" -> parseTodoUpdate(payload, context)
            "model_mode" -> parseModelMode(payload, context)
            else -> null
        }
    }.getOrNull()

    private fun parseStreamEnd(payload: String): ParsedAgentEvent.StreamEnd {
        if (payload.isBlank()) {
            return ParsedAgentEvent.StreamEnd(finalText = null)
        }
        val json = runCatching { JSONObject(payload) }.getOrNull()
        return ParsedAgentEvent.StreamEnd(finalText = json?.optString("finalText")?.takeIf { it.isNotBlank() })
    }

    private fun parseThinking(payload: String, context: AgentParseContext): ParsedAgentEvent.Thinking {
        val obj = JSONObject(payload)
        val item = ChatItem.Thinking(
            content = obj.optString("thinking", ""),
            turnId = obj.optString("turnId").takeIf { it.isNotBlank() },
            ephemeral = obj.optBoolean("ephemeral", false),
            done = obj.optBoolean("done", false),
            phase = obj.optString("phase").takeIf { it.isNotBlank() },
            elapsedMs = obj.optLong("elapsedMs", -1L).takeIf { it >= 0L },
            agent = obj.optString("agent").takeIf { it.isNotBlank() } ?: context.fallbackAgent,
        )
        return ParsedAgentEvent.Thinking(item = item, done = item.done)
    }

    private fun parseToolCall(payload: String, context: AgentParseContext): ParsedAgentEvent.ToolCall {
        val obj = JSONObject(payload)
        val tool = obj.getString("tool")
        val params = obj.optJSONObject("params")
        val status = obj.getString("status")
        val summary = if (status == "running") {
            ToolSummary.formatOneLiner(tool, params)
        } else {
            ToolSummary.formatOneLiner(tool, null)
        }
        val item = ChatItem.ToolCall(
            tool = tool,
            status = status,
            result = obj.opt("result")?.takeIf { it != JSONObject.NULL }?.toString(),
            summary = summary,
            toolUseId = obj.optString("toolUseId").takeIf { it.isNotBlank() },
            agent = obj.optString("agent").takeIf { it.isNotBlank() } ?: context.fallbackAgent,
        )
        return ParsedAgentEvent.ToolCall(item = item, paramsSummary = summary)
    }

    private fun parseUsageReport(payload: String, context: AgentParseContext): ParsedAgentEvent.UsageReport? {
        val obj = JSONObject(payload)
        val usage = obj.optJSONObject("usage") ?: return null
        return ParsedAgentEvent.UsageReport(
            item = ChatItem.UsageInfo(
                inputTokens = usage.optInt("inputTokens", 0),
                outputTokens = usage.optInt("outputTokens", 0),
                cacheCreationTokens = usage.optInt("cacheCreationTokens", 0),
                cacheReadTokens = usage.optInt("cacheReadTokens", 0),
                taskId = obj.optString("taskId").takeIf { it.isNotBlank() },
                agent = context.fallbackAgent,
            ),
            cumulative = obj.optBoolean("cumulative", false),
        )
    }

    private fun parseFileDiff(payload: String, context: AgentParseContext): ParsedAgentEvent.FileDiff {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.FileDiff(
            ChatItem.FileDiff(
                path = obj.getString("path"),
                diff = obj.getString("diff"),
                action = obj.getString("action"),
                agent = context.fallbackAgent,
            )
        )
    }

    private fun parseDiffActionResult(payload: String): ParsedAgentEvent.DiffActionResult {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.DiffActionResult(
            path = obj.optString("path"),
            action = obj.optString("action", "unknown"),
            success = obj.optBoolean("success", false),
            error = obj.optString("error").takeIf { it.isNotBlank() },
        )
    }

    private fun parseStatus(payload: String, context: AgentParseContext): ParsedAgentEvent.StatusUpdate {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.StatusUpdate(
            status = obj.optString("status", context.currentStatus ?: "idle"),
            projectPath = obj.optString("projectPath").takeIf { it.isNotBlank() } ?: context.currentProjectPath,
            runningTasks = obj.optInt("runningTasks", context.currentRunningTasks ?: 0).coerceAtLeast(0),
            pendingApprovals = obj.optInt("pendingApprovals", context.currentPendingApprovals ?: 0).coerceAtLeast(0),
            reason = obj.optString("reason").takeIf { it.isNotBlank() } ?: (context.currentTurnReason ?: "startup"),
            version = obj.optInt("version", context.currentTurnVersion ?: 0),
            updatedAt = obj.optLong("updatedAt", System.currentTimeMillis()),
        )
    }

    private fun parseHeartbeat(payload: String, context: AgentParseContext): ParsedAgentEvent.HeartbeatUpdate {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.HeartbeatUpdate(
            status = obj.optString("status", "idle"),
            uptime = obj.optInt("uptime", 0),
            projectPath = obj.optString("projectPath").takeIf { it.isNotBlank() },
            agent = obj.optString("agent", context.fallbackAgent ?: "claude"),
            runningTasks = parseRunningTasks(obj.optJSONArray("runningTasks")),
            permissionMode = obj.optString("permissionMode", context.currentPermissionMode ?: "default"),
            metadataVersion = obj.optInt("metadataVersion", 0),
            modelMode = obj.optString("modelMode", context.currentModelMode ?: "default"),
            turnStateVersion = obj.optInt("turnStateVersion", context.currentTurnVersion ?: 0),
            turnStateReason = obj.optString("turnStateReason").takeIf { it.isNotBlank() } ?: (context.currentTurnReason ?: "startup"),
        )
    }

    private fun parseTurnState(payload: String, context: AgentParseContext): ParsedAgentEvent.TurnStateUpdate {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.TurnStateUpdate(
            phase = obj.optString("phase", context.currentStatus ?: "idle"),
            version = obj.optInt("version", context.currentTurnVersion ?: 0),
            reason = obj.optString("reason").takeIf { it.isNotBlank() } ?: (context.currentTurnReason ?: "startup"),
            updatedAt = obj.optLong("updatedAt", System.currentTimeMillis()),
            runningTasks = obj.optInt("runningTasks", context.currentRunningTasks ?: 0).coerceAtLeast(0),
            pendingApprovals = obj.optInt("pendingApprovals", context.currentPendingApprovals ?: 0).coerceAtLeast(0),
        )
    }

    private fun parseInteractionState(payload: String, context: AgentParseContext): ParsedAgentEvent.InteractionStateUpdate {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.InteractionStateUpdate(
            phase = obj.optString("state", context.currentStatus ?: "idle"),
            version = obj.optInt("version", context.currentTurnVersion ?: 0),
            reason = obj.optString("reason").takeIf { it.isNotBlank() } ?: (context.currentTurnReason ?: "startup"),
            updatedAt = obj.optLong("updatedAt", System.currentTimeMillis()),
            runningTasks = obj.optInt("runningTasks", context.currentRunningTasks ?: 0).coerceAtLeast(0),
            pendingApprovals = obj.optInt("pendingApprovals", context.currentPendingApprovals ?: 0).coerceAtLeast(0),
            availableActions = parseStringArray(obj.optJSONArray("availableActions")) { it.trim().lowercase() },
            activeApprovalId = obj.optString("activeApprovalId").takeIf { it.isNotBlank() },
            riskLevel = obj.optString("riskLevel").takeIf { it.isNotBlank() },
            riskSummary = obj.optString("riskSummary", ""),
            diffHighlights = parseStringArray(obj.optJSONArray("diffHighlights")) { it.trim() },
            lastError = obj.optString("lastError", ""),
        )
    }

    private fun parseReplayDone(payload: String): ParsedAgentEvent.ReplayDone {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.ReplayDone(
            sessionId = obj.optString("sessionId"),
            replayed = obj.optInt("replayed", 0),
            daemonCached = obj.optInt("daemonCached", 0),
            rounds = obj.optInt("rounds", 0),
            reason = obj.optString("reason", "manual"),
            at = obj.optLong("at", 0L),
        )
    }

    private fun parseForegroundProbeAck(payload: String, context: AgentParseContext): ParsedAgentEvent.ForegroundProbeAck {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.ForegroundProbeAck(
            probeId = obj.optString("probeId").takeIf { it.isNotBlank() },
            clientTs = obj.optLong("clientTs", 0L),
            serverTs = obj.optLong("serverTs", 0L),
            sessionId = obj.optString("sessionId"),
            status = obj.optString("status", context.currentStatus ?: "idle"),
            cwd = obj.optString("cwd").takeIf { it.isNotBlank() },
            turnStateVersion = obj.optInt("turnStateVersion", context.currentTurnVersion ?: 0),
            turnStateReason = obj.optString("turnStateReason").takeIf { it.isNotBlank() } ?: (context.currentTurnReason ?: "startup"),
            runningTasks = obj.optInt("runningTasks", context.currentRunningTasks ?: 0).coerceAtLeast(0),
            pendingApprovals = obj.optInt("pendingApprovals", context.currentPendingApprovals ?: 0).coerceAtLeast(0),
            permissionMode = obj.optString("permissionMode", context.currentPermissionMode ?: "default"),
            modelMode = obj.optString("modelMode", context.currentModelMode ?: "default"),
        )
    }

    private fun parseHookEvent(payload: String, context: AgentParseContext): ParsedAgentEvent.HookEvent {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.HookEvent(
            ChatItem.HookEvent(
                hook = obj.optString("hook"),
                event = obj.optString("event"),
                tool = obj.optString("tool").takeIf { it.isNotBlank() },
                agent = obj.optString("agent").takeIf { it.isNotBlank() } ?: context.fallbackAgent,
            )
        )
    }

    private fun parseApproval(payload: String, context: AgentParseContext): ParsedAgentEvent.ApprovalRequest {
        val obj = JSONObject(payload)
        val tool = obj.getString("tool")
        return ParsedAgentEvent.ApprovalRequest(
            ChatItem.Approval(
                id = obj.optString("id").takeIf { it.isNotBlank() } ?: context.envelopeId.orEmpty(),
                desc = obj.getString("description"),
                tool = tool,
                files = parseStringArray(obj.optJSONArray("affectedFiles")) { it },
                riskLevel = normalizeApprovalRisk(obj.optString("riskLevel"), tool),
                riskSummary = obj.optString("riskSummary", ""),
                diffHighlights = parseStringArray(obj.optJSONArray("diffHighlights")) { it.trim() },
                preview = obj.optString("preview").takeIf { it.isNotBlank() },
                context = obj.optString("context").takeIf { it.isNotBlank() },
                permissionMode = obj.optString("permissionMode").takeIf { it.isNotBlank() },
                agent = obj.optString("agent").takeIf { it.isNotBlank() } ?: context.fallbackAgent,
            )
        )
    }

    private fun parseTodoUpdate(payload: String, context: AgentParseContext): ParsedAgentEvent.TodoUpdate {
        val obj = JSONObject(payload)
        val todos = mutableListOf<TodoItem>()
        val arr = obj.optJSONArray("todos")
        if (arr != null) {
            for (index in 0 until arr.length()) {
                val item = arr.getJSONObject(index)
                todos.add(
                    TodoItem(
                        id = item.optString("id"),
                        content = item.optString("content"),
                        status = item.optString("status", "pending"),
                        priority = item.optString("priority", "medium"),
                    )
                )
            }
        }
        return ParsedAgentEvent.TodoUpdate(
            ChatItem.TodoUpdate(
                todos = todos,
                taskId = obj.optString("taskId").takeIf { it.isNotBlank() },
                agent = context.fallbackAgent,
            )
        )
    }

    private fun parseModelMode(payload: String, context: AgentParseContext): ParsedAgentEvent.ModelModeUpdate {
        val obj = JSONObject(payload)
        return ParsedAgentEvent.ModelModeUpdate(
            modeValue = obj.optString("mode", context.currentModelMode ?: "default")
        )
    }

    private fun parseRunningTasks(arr: JSONArray?): List<ParsedAgentEvent.RunningTask> {
        if (arr == null) return emptyList()
        val tasks = mutableListOf<ParsedAgentEvent.RunningTask>()
        for (index in 0 until arr.length()) {
            val item = arr.optJSONObject(index) ?: continue
            val taskId = item.optString("taskId").trim()
            val agent = item.optString("agent").trim()
            if (taskId.isNotBlank() && agent.isNotBlank()) {
                tasks.add(ParsedAgentEvent.RunningTask(taskId = taskId, agent = agent))
            }
        }
        return tasks
    }

    private fun parseStringArray(arr: JSONArray?, transform: (String) -> String): List<String> {
        if (arr == null) return emptyList()
        val items = mutableListOf<String>()
        for (index in 0 until arr.length()) {
            val value = transform(arr.optString(index))
            if (value.isNotBlank()) {
                items.add(value)
            }
        }
        return items
    }

    private fun normalizeApprovalRisk(raw: String?, tool: String): String {
        val normalized = raw?.trim()?.lowercase().orEmpty()
        if (normalized == "critical") return "high"
        if (normalized in setOf("low", "medium", "high", "safe")) return normalized
        return when (tool.trim().lowercase()) {
            "ls", "read", "read_file", "grep", "git_status", "git_log", "download_file" -> "low"
            "write_file", "write", "rename", "mkdir" -> "medium"
            else -> "high"
        }
    }
}

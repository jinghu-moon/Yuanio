package com.yuanio.app.ui.screen

import android.app.Application
import com.yuanio.app.YuanioApp
import androidx.annotation.StringRes
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.yuanio.app.R
import com.yuanio.app.data.ChatHistory
import com.yuanio.app.data.ChatHistoryEntry
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.EnvelopeHelper
import com.yuanio.app.data.FeaturePrefs
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.Notifier
import com.yuanio.app.data.ApiClient
import com.yuanio.app.data.MessageExporter
import com.yuanio.app.data.ModelMode
import com.yuanio.app.data.PermissionMode
import com.yuanio.app.data.TodoItem
import com.yuanio.app.data.NoiseFilter
import com.yuanio.app.data.ToolSummary
import com.yuanio.app.data.TtsManager
import com.yuanio.app.data.TtsPrefs
import com.yuanio.app.data.TtsState
import com.yuanio.app.data.ConnectionMode
import com.yuanio.app.data.LocalConnectionPrefs
import com.yuanio.app.data.LocalRelayClient
import com.yuanio.app.data.SessionGateway
import com.yuanio.app.data.SessionGatewayCallbacks
import com.yuanio.app.data.SessionGatewayConfig
import com.yuanio.app.data.SESSION_GATEWAY_ERROR_LOCAL_UNAVAILABLE_MISSING_KEY
import com.yuanio.app.data.MessageTransport
import com.yuanio.app.data.RelayAck
import com.yuanio.app.data.RelayAckState
import com.yuanio.app.data.DraftStore
import com.yuanio.app.data.PendingApprovalStore
import com.yuanio.app.data.NotificationPrefs
import com.yuanio.app.data.AgentEventParser
import com.yuanio.app.data.AgentParseContext
import com.yuanio.app.data.ParsedAgentEvent
import com.yuanio.app.data.WorkflowQueuedTask
import com.yuanio.app.data.WorkflowSnapshotStore
import com.yuanio.app.data.WorkflowTaskSummary
import com.yuanio.app.crypto.CryptoManager
import com.yuanio.app.ui.common.UiText
import com.yuanio.app.ui.model.ChatItem
import com.yuanio.app.ui.model.DeliveryStatus
import com.yuanio.app.ui.model.ToolCallStatus
import com.yuanio.app.widget.AgentWidget
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import android.util.Base64
import android.util.Log
import android.os.Handler
import android.os.Looper
import java.util.ArrayDeque

internal object AutoRejectPolicy {
    private const val MEDIUM_TIMEOUT_MS = 60_000L
    private const val HIGH_TIMEOUT_MS = 30_000L

    fun timeoutMs(enabled: Boolean, riskLevel: String?): Long? {
        if (!enabled) return null
        return when (riskLevel?.trim()?.lowercase()) {
            "low", "safe" -> null
            "high" -> HIGH_TIMEOUT_MS
            else -> MEDIUM_TIMEOUT_MS
        }
    }
}

private const val SEARCH_QUERY_DEBOUNCE_MS = 180L

@OptIn(ExperimentalCoroutinesApi::class)
internal fun Flow<String>.debouncedSearchQuery(
    debounceMs: Long = SEARCH_QUERY_DEBOUNCE_MS,
): Flow<String> = transformLatest { query ->
    if (query.isBlank()) {
        emit("")
    } else {
        delay(debounceMs)
        emit(query)
    }
}.distinctUntilChanged()

internal fun resolveSessionGateway(app: Application): SessionGateway {
    require(app is YuanioApp) { "ChatViewModel requires YuanioApp" }
    return app.sessionGateway
}

private fun normalizeChatTextTaskId(taskId: String?): String? {
    return taskId?.trim()?.ifBlank { null }
}

private fun extractChatTextTaskId(text: String): String? {
    return Regex("""/task\s+([a-zA-Z0-9._:-]{6,})""")
        .find(text)
        ?.groupValues
        ?.getOrNull(1)
        ?.trim()
        ?.ifBlank { null }
}

internal fun resolveLatestHistoryTaskId(items: List<ChatItem.Text>): String? {
    return items.asReversed().firstNotNullOfOrNull { item ->
        normalizeChatTextTaskId(item.taskId) ?: extractChatTextTaskId(item.content)
    }
}

internal fun resolveOutgoingChatTextTaskId(currentTaskId: String?, text: String): String? {
    return extractChatTextTaskId(text) ?: normalizeChatTextTaskId(currentTaskId)
}

internal fun mergeStreamingChatText(
    current: List<ChatItem>,
    content: String,
    currentAgent: String?,
    currentTaskId: String?,
): List<ChatItem> {
    val normalizedTaskId = normalizeChatTextTaskId(currentTaskId)
    val items = current.toMutableList()
    val last = items.lastOrNull()
    if (last is ChatItem.Text && last.role == "ai") {
        items[items.lastIndex] = last.copy(
            content = content,
            taskId = last.taskId ?: normalizedTaskId,
            agent = currentAgent ?: last.agent,
        )
    } else {
        items.add(ChatItem.Text("ai", content, taskId = normalizedTaskId, agent = currentAgent))
    }
    return items
}

private fun ChatItem.Text.toHistoryEntry(): ChatHistoryEntry {
    return ChatHistoryEntry(
        type = role,
        content = content,
        taskId = normalizeChatTextTaskId(taskId),
        agent = agent?.trim()?.ifBlank { null },
        ts = ts,
    )
}

class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val agentEventParser = AgentEventParser()
    private val keyStore = KeyStore(app)
    private val history = ChatHistory(app)
    private val draftStore = DraftStore(app)
    private val sessionGateway: SessionGateway = resolveSessionGateway(app)
    private val relay: MessageTransport?
        get() = sessionGateway.transport
    private var activeSessionId: String? = null
    private var receivingStream = false
    private var tokenRefreshStarted = false
    private var switchingSession = false
    private var pendingSessionSwitchId: String? = null
    private var pendingSwitchAckSessionId: String? = null
    private var pendingOutboundSwitchAck: String? = null
    private var switchAckTimeout: Runnable? = null
    private val switchAckTimeoutMs = 8000L
    private val userUndoWindowMs = 8_000L
    private val userEditWindowMs = 15 * 60 * 1000L
    private val userEditMaxCount = 5

    init {
        sessionGateway.bind(buildSessionGatewayCallbacks())
    }

    private val _items = MutableStateFlow<List<ChatItem>>(emptyList())
    val items = _items.asStateFlow()

    private val _connState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connState = _connState.asStateFlow()

    private val _streaming = MutableStateFlow(false)
    val streaming = _streaming.asStateFlow()

    private val _viewSessionId = MutableStateFlow<String?>(null)
    val viewSessionId = _viewSessionId.asStateFlow()

    private val _viewingActiveSession = MutableStateFlow(true)
    val viewingActiveSession = _viewingActiveSession.asStateFlow()

    // 等待 Agent 首次响应的状态
    private val _waiting = MutableStateFlow(false)
    val waiting = _waiting.asStateFlow()

    // 延迟诊断：发送时间戳
    private var sendTimestamp = 0L

    // ACK 可靠发送
    private data class PendingPrompt(
        val messageId: String,
        val envelope: JSONObject,
        val message: ChatItem.Text,
        var retries: Int = 0,
        var timeout: Runnable? = null
    )
    private val pendingPrompts = mutableMapOf<String, PendingPrompt>()
    private val ackHandler = Handler(Looper.getMainLooper())
    private var currentTextTaskId: String? = null
    private val inboundAckRequiredTypes = setOf(
        "prompt",
        "approval_resp",
        "session_switch_ack",
        "diff_action_result",
    )

    private fun ackBaseTimeoutMs(): Long {
        return if (_connectionType.value == "local") 2500L else 7000L
    }

    private fun ackTimeoutMsForRetry(retry: Int): Long {
        val factor = (retry + 1).coerceAtMost(4)
        return (ackBaseTimeoutMs() * factor).coerceAtMost(20_000L)
    }

    private fun ackMaxRetries(): Int {
        return if (_connectionType.value == "local") 2 else 4
    }

    // Agent 心跳状态
    data class RunningTask(val taskId: String, val agent: String)
    data class AgentHeartbeat(
        val status: String = "offline",
        val uptime: Int = 0,
        val projectPath: String? = null,
        val agent: String = "claude",
        val lastSeen: Long = 0,
        val runningTasks: List<RunningTask> = emptyList(),
        val permissionMode: PermissionMode = PermissionMode.DEFAULT,
        val metadataVersion: Int = 0,
        val modelMode: ModelMode = ModelMode.DEFAULT
    )
    private val _agentState = MutableStateFlow(AgentHeartbeat())
    val agentState = _agentState.asStateFlow()

    data class TurnState(
        val phase: String = "idle",
        val version: Int = 0,
        val reason: String = "startup",
        val updatedAt: Long = 0L,
        val runningTasks: Int = 0,
        val pendingApprovals: Int = 0,
        val availableActions: List<String> = emptyList(),
        val activeApprovalId: String? = null,
        val riskLevel: String? = null,
        val riskSummary: String = "",
        val diffHighlights: List<String> = emptyList(),
        val lastError: String = "",
    )
    private val _turnState = MutableStateFlow(TurnState())
    val turnState = _turnState.asStateFlow()

    enum class RecoveryIssueType {
        AGENT_OFFLINE,
        TOKEN_INVALID,
        PUSH_DISABLED,
    }

    data class RecoveryIssue(
        val type: RecoveryIssueType,
        val title: String,
        val summary: String,
        val actionLabel: String,
    )
    private val _recoveryIssues = MutableStateFlow<List<RecoveryIssue>>(emptyList())
    val recoveryIssues = _recoveryIssues.asStateFlow()

    data class HandoffRequest(
        val sessionId: String,
        val sourceDeviceId: String?,
        val reason: String?,
        val requestedAt: Long,
    )
    private data class PendingHandoff(
        val sessionId: String,
        val token: String,
        val sharedKey: ByteArray,
        val sourceDeviceId: String?,
        val reason: String?,
    )
    private var pendingHandoff: PendingHandoff? = null
    private val _handoffRequest = MutableStateFlow<HandoffRequest?>(null)
    val handoffRequest = _handoffRequest.asStateFlow()

    private var relayTokenInvalid = false
    private var agentOfflineIssue = false
    private var pushRegistrationHealthy = true

    data class ReplayState(
        val sessionId: String = "",
        val replayed: Int = 0,
        val daemonCached: Int = 0,
        val rounds: Int = 0,
        val reason: String = "",
        val at: Long = 0L,
    )
    private val _replayState = MutableStateFlow<ReplayState?>(null)
    val replayState = _replayState.asStateFlow()

    data class ForegroundProbeState(
        val status: String = "unknown",
        val latencyMs: Long? = null,
        val lastAckAt: Long = 0L,
        val cwd: String? = null,
        val runningTasks: Int = 0,
        val pendingApprovals: Int = 0,
        val turnStateVersion: Int = 0,
        val turnStateReason: String = "",
    )
    private val _foregroundProbe = MutableStateFlow(ForegroundProbeState())
    val foregroundProbe = _foregroundProbe.asStateFlow()
    private var pendingProbeId: String? = null
    private var pendingProbeSentAtMs: Long = 0L

    data class SessionControlState(
        val contextUsedPercentage: Int = 0,
        val contextTokens: Int = 0,
        val contextWindowSize: Int = 0,
        val runningTasks: Int = 0,
        val queueTasks: Int = 0,
        val memoryEnabled: Boolean = true,
        val outputStyleId: String = "default",
        val statusline: String = "",
        val lastCompactPromptId: String? = null,
        val lastUpdatedAt: Long = 0L,
    )
    private val _sessionControl = MutableStateFlow(SessionControlState())
    val sessionControl = _sessionControl.asStateFlow()

    // Shell 回退模式：agent offline 时用户消息作为 shell 命令执行
    val shellMode get() = _agentState.value.status == "offline"
    private val pendingShellRpc = mutableMapOf<String, ChatItem.Text>()
    private val pendingRpcCallbacks = mutableMapOf<String, (JSONObject) -> Unit>()

    // TTS 朗读
    private val ttsManager = TtsManager(app)
    private val _speakingIndex = MutableStateFlow(-1)
    val speakingIndex = _speakingIndex.asStateFlow()

    // 连接类型（relay / local）
    private val _connectionType = MutableStateFlow("relay")
    val connectionType = _connectionType.asStateFlow()

    // 在线设备列表
    data class ConnectedDevice(val deviceId: String, val role: String)
    private val _devices = MutableStateFlow<List<ConnectedDevice>>(emptyList())
    val devices = _devices.asStateFlow()

    // 终端输出流
    private val _terminalLines = MutableStateFlow<List<String>>(emptyList())
    val terminalLines = _terminalLines.asStateFlow()

    private val _toast = MutableStateFlow<UiText?>(null)
    val toast = _toast.asStateFlow()
    fun clearToast() { _toast.value = null }
    private fun s(@StringRes id: Int, vararg args: Any): String =
        getApplication<Application>().getString(id, *args)
    private fun toastRes(@StringRes id: Int, vararg args: Any) {
        _toast.value = UiText.res(id, *args)
    }
    private var toastText: String?
        get() = (toast.value as? UiText.Raw)?.value
        set(value) { _toast.value = value?.let(UiText::raw) }

    private val _pendingDraftCount = MutableStateFlow(draftStore.size())
    val pendingDraftCount = _pendingDraftCount.asStateFlow()

    // 紧急审批弹窗
    private val _urgentApproval = MutableStateFlow<ChatItem.Approval?>(null)
    val urgentApproval = _urgentApproval.asStateFlow()
    fun clearUrgentApproval() { _urgentApproval.value = null }
    private val pendingApprovals = linkedMapOf<String, ChatItem.Approval>()
    private val _pendingApprovalQueue = MutableStateFlow<List<ChatItem.Approval>>(emptyList())
    val pendingApprovalQueue = _pendingApprovalQueue.asStateFlow()
    private val _safeApprovalCount = MutableStateFlow(0)
    val safeApprovalCount = _safeApprovalCount.asStateFlow()
    private val approvalUndoWindowMs = 10_000L
    private data class PendingApprovalCommit(
        val approval: ChatItem.Approval,
        val approved: Boolean,
        val queuedAtMs: Long,
        var commitJob: Job? = null,
    )
    data class ApprovalUndoState(
        val approvalId: String,
        val approved: Boolean,
        val expiresAtMs: Long,
    )
    private val pendingApprovalCommits = linkedMapOf<String, PendingApprovalCommit>()
    private val approvalAutoRejectJobs = linkedMapOf<String, Job>()
    private val _approvalUndoState = MutableStateFlow<ApprovalUndoState?>(null)
    val approvalUndoState = _approvalUndoState.asStateFlow()

    data class SlashCommandSuggestion(
        val command: String,
        val usage: String,
        val description: String,
        val insertText: String,
        val group: String,
        val argsTemplate: String? = null,
        val example: String? = null,
    )
    private val slashCommandCatalog = listOf(
        SlashCommandSuggestion("help", "/help", s(R.string.chat_vm_slash_help_desc), "/help", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("status", "/status", s(R.string.chat_vm_slash_status_desc), "/status", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("probe", "/probe", s(R.string.chat_vm_slash_probe_desc), "/probe", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("history", "/history 12", s(R.string.chat_vm_slash_history_desc), "/history 12", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion(
            "task",
            "/task <taskId> [page]",
            s(R.string.chat_vm_slash_task_desc),
            "/task ",
            s(R.string.chat_slash_group_system),
            argsTemplate = "<taskId> [page]",
            example = "/task abcd1234 1",
        ),
        SlashCommandSuggestion("approvals", "/approvals [page]", s(R.string.chat_vm_slash_approvals_desc), "/approvals", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("approve", "/approve [id]", s(R.string.chat_vm_slash_approve_desc), "/approve ", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("reject", "/reject [id]", s(R.string.chat_vm_slash_reject_desc), "/reject ", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("undo-approval", "/undo-approval [id]", s(R.string.chat_vm_slash_undo_desc), "/undo-approval", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("watch", "/watch approvals on", s(R.string.chat_vm_slash_watch_desc), "/watch ", s(R.string.chat_slash_group_automation)),
        SlashCommandSuggestion("tasks", "/tasks", s(R.string.chat_vm_slash_tasks_desc), "/tasks", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("cwd", "/cwd", s(R.string.chat_vm_slash_cwd_desc), "/cwd", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion("mode", "/mode plan|act", s(R.string.chat_vm_slash_mode_desc), "/mode ", s(R.string.chat_slash_group_automation)),
        SlashCommandSuggestion("context", "/context", s(R.string.chat_vm_slash_context_desc), "/context", s(R.string.chat_slash_group_system)),
        SlashCommandSuggestion(
            "z2e",
            "/z2e <text>",
            s(R.string.chat_vm_slash_z2e_desc),
            "/z2e ",
            s(R.string.chat_slash_group_translation),
            argsTemplate = "<text>",
            example = "/z2e 你好，今天继续迭代",
        ),
        SlashCommandSuggestion(
            "e2z",
            "/e2z <text>",
            s(R.string.chat_vm_slash_e2z_desc),
            "/e2z ",
            s(R.string.chat_slash_group_translation),
            argsTemplate = "<text>",
            example = "/e2z Please summarize this module",
        ),
    )
    private val _recentCommands = MutableStateFlow<List<String>>(emptyList())
    val recentCommands = _recentCommands.asStateFlow()

    private fun recordRecentCommand(command: String) {
        val normalized = command.trim()
        if (!normalized.startsWith("/")) return
        val current = _recentCommands.value.filterNot { it.equals(normalized, ignoreCase = true) }.toMutableList()
        current.add(0, normalized)
        _recentCommands.value = current.take(8)
    }

    private val _preferredConnectionMode = MutableStateFlow(LocalConnectionPrefs.mode)
    val preferredConnectionMode = _preferredConnectionMode.asStateFlow()

    // Todo 列表（最新一次 todo_update 的内容）
    private val _todos = MutableStateFlow<List<TodoItem>>(emptyList())
    val todos = _todos.asStateFlow()

    // Auto-Pilot 循环模式
    data class AutoPilotState(
        val enabled: Boolean = false,
        val iteration: Int = 0,
        val maxIterations: Int = 10,
        val prompt: String = "continue",
    )
    private val _autoPilot = MutableStateFlow(AutoPilotState())
    val autoPilot = _autoPilot.asStateFlow()

    data class ChatUiState(
        val connState: ConnectionState = ConnectionState.DISCONNECTED,
        val streaming: Boolean = false,
        val waiting: Boolean = false,
        val agentState: AgentHeartbeat = AgentHeartbeat(),
        val autoPilot: AutoPilotState = AutoPilotState(),
        val terminalLines: List<String> = emptyList(),
        val viewingActiveSession: Boolean = true,
        val devices: List<ConnectedDevice> = emptyList(),
        val speakingIndex: Int = -1,
        val searchActive: Boolean = false,
        val searchQuery: String = "",
        val appliedSearchQuery: String = "",
        val connectionType: String = "relay",
    )

    private val vibingMessages = listOf(
        s(R.string.chat_vm_vibing_thinking),
        s(R.string.chat_vm_vibing_reading_code),
        s(R.string.chat_vm_vibing_writing),
        s(R.string.chat_vm_vibing_exploring_files),
        s(R.string.chat_vm_vibing_analyzing),
        s(R.string.chat_vm_vibing_refactoring),
        s(R.string.chat_vm_vibing_debugging),
        s(R.string.chat_vm_vibing_optimizing),
        s(R.string.chat_vm_vibing_searching_docs),
    )

    private val _vibingMessage = MutableStateFlow("")
    val vibingMessage = _vibingMessage.asStateFlow()
    private var vibingJob: Job? = null

    private val autoPilotCompletionMarkers = listOf(
        "DONE", "完成", "FINISHED", "ALL DONE", "COMPLETE",
        "没有更多", "no more", "nothing left", "all tasks completed",
    )

    // --- 搜索状态 ---
    private val _searchQuery = MutableStateFlow("")
    val searchQuery = _searchQuery.asStateFlow()

    private val _searchActive = MutableStateFlow(false)
    val searchActive = _searchActive.asStateFlow()

    private val appliedSearchQuery = _searchQuery
        .debouncedSearchQuery()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "")

    private data class InputUiState(
        val speakingIndex: Int,
        val searchActive: Boolean,
        val searchQuery: String,
        val appliedSearchQuery: String,
        val connectionType: String,
    )

    private val primaryUiState = combine(
        _connState,
        _streaming,
        _waiting,
        _agentState,
        _autoPilot,
    ) { connState, streaming, waiting, agentState, autoPilot ->
        ChatUiState(
            connState = connState,
            streaming = streaming,
            waiting = waiting,
            agentState = agentState,
            autoPilot = autoPilot,
        )
    }

    private val listUiState = combine(
        _terminalLines,
        _viewingActiveSession,
        _devices,
    ) { terminalLines, viewingActiveSession, devices ->
        Triple(terminalLines, viewingActiveSession, devices)
    }

    private val inputUiState = combine(
        _speakingIndex,
        _searchActive,
        _searchQuery,
        appliedSearchQuery,
        _connectionType,
    ) { speakingIndex, searchActive, searchQuery, appliedSearchQueryValue, connectionType ->
        InputUiState(
            speakingIndex = speakingIndex,
            searchActive = searchActive,
            searchQuery = searchQuery,
            appliedSearchQuery = appliedSearchQueryValue,
            connectionType = connectionType,
        )
    }

    val uiState: StateFlow<ChatUiState> = combine(
        primaryUiState,
        listUiState,
        inputUiState,
    ) { primary, lists, input ->
        primary.copy(
            terminalLines = lists.first,
            viewingActiveSession = lists.second,
            devices = lists.third,
            speakingIndex = input.speakingIndex,
            searchActive = input.searchActive,
            searchQuery = input.searchQuery,
            appliedSearchQuery = input.appliedSearchQuery,
            connectionType = input.connectionType,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5000),
        ChatUiState(),
    )

    val filteredItems = combine(_items, appliedSearchQuery) { items, query ->
        if (query.isBlank()) items
        else items.filter { item ->
            when (item) {
                is ChatItem.Text -> item.content.contains(query, ignoreCase = true)
                is ChatItem.ToolCall -> item.tool.contains(query, ignoreCase = true)
                        || item.summary?.contains(query, ignoreCase = true) == true
                        || item.result?.contains(query, ignoreCase = true) == true
                is ChatItem.Thinking -> item.content.contains(query, ignoreCase = true)
                is ChatItem.FileDiff -> item.path.contains(query, ignoreCase = true)
                is ChatItem.TodoUpdate -> item.todos.any { it.content.contains(query, ignoreCase = true) }
                else -> false
            }
        }
    }

    fun setSearchQuery(query: String) { _searchQuery.value = query }
    fun toggleSearch() {
        _searchActive.value = !_searchActive.value
        if (!_searchActive.value) _searchQuery.value = ""
    }

    private fun isSafeApprovalRisk(risk: String): Boolean {
        val normalized = risk.lowercase()
        return normalized == "low" || normalized == "safe"
    }

    private fun cancelAutoReject(approvalId: String) {
        approvalAutoRejectJobs.remove(approvalId)?.cancel()
    }

    private fun scheduleAutoRejectIfNeeded(approval: ChatItem.Approval) {
        cancelAutoReject(approval.id)
        val timeoutMs = AutoRejectPolicy.timeoutMs(
            enabled = FeaturePrefs.approvalAutoRejectEnabled,
            riskLevel = approval.riskLevel,
        ) ?: return
        approvalAutoRejectJobs[approval.id] = viewModelScope.launch {
            delay(timeoutMs)
            if (pendingApprovals.containsKey(approval.id)) {
                respondApproval(approval.id, approved = false)
            }
        }
    }

    private fun syncApprovalQueueState() {
        _safeApprovalCount.value = pendingApprovals.values.count { isSafeApprovalRisk(it.riskLevel) }
        _pendingApprovalQueue.value = pendingApprovals.values.toList()
        _turnState.value = _turnState.value.copy(pendingApprovals = pendingApprovals.size)
        syncWorkflowSnapshotState()
    }

    private fun queueDraft(text: String) {
        runCatching { draftStore.add(text) }
        _pendingDraftCount.value = draftStore.size()
        toastRes(R.string.chat_vm_toast_draft_queued_offline)
    }

    private fun canSendRealtime(): Boolean {
        return _connState.value == ConnectionState.CONNECTED && relay?.isConnected == true
    }

    private fun inferTokenInvalid(error: String): Boolean {
        val lowered = error.lowercase()
        return lowered.contains("token")
            || lowered.contains("unauthorized")
            || lowered.contains("forbidden")
            || lowered.contains("401")
            || lowered.contains("403")
    }

    private fun refreshRecoveryIssues() {
        val issues = mutableListOf<RecoveryIssue>()
        val pushDisabled = keyStore.fcmToken.isNullOrBlank() || !pushRegistrationHealthy || !NotificationPrefs.approvalEnabled

        if (_connState.value != ConnectionState.CONNECTED || agentOfflineIssue) {
            issues += RecoveryIssue(
                type = RecoveryIssueType.AGENT_OFFLINE,
                title = s(R.string.chat_vm_recovery_agent_offline_title),
                summary = s(R.string.chat_vm_recovery_agent_offline_summary),
                actionLabel = s(R.string.chat_vm_recovery_agent_offline_action),
            )
        }
        if (relayTokenInvalid) {
            issues += RecoveryIssue(
                type = RecoveryIssueType.TOKEN_INVALID,
                title = s(R.string.chat_vm_recovery_token_invalid_title),
                summary = s(R.string.chat_vm_recovery_token_invalid_summary),
                actionLabel = s(R.string.chat_vm_recovery_token_invalid_action),
            )
        }
        if (pushDisabled) {
            issues += RecoveryIssue(
                type = RecoveryIssueType.PUSH_DISABLED,
                title = s(R.string.chat_vm_recovery_push_disabled_title),
                summary = s(R.string.chat_vm_recovery_push_disabled_summary),
                actionLabel = s(R.string.chat_vm_recovery_push_disabled_action),
            )
        }
        _recoveryIssues.value = issues
    }

    fun resendPendingDrafts() {
        flushPendingDrafts(manual = true)
    }

    private fun flushPendingDrafts(manual: Boolean = false) {
        if (!canSendRealtime()) {
            if (manual) toastRes(R.string.chat_vm_toast_draft_send_offline)
            return
        }
        val pending = draftStore.list()
        if (pending.isEmpty()) {
            _pendingDraftCount.value = 0
            if (manual) toastRes(R.string.chat_vm_toast_draft_empty)
            return
        }

        var sent = 0
        for (draft in pending) {
            if (!canSendRealtime()) break
            val ok = sendNow(draft.text)
            if (ok) {
                draftStore.remove(draft.id)
                sent += 1
            }
        }
        _pendingDraftCount.value = draftStore.size()
        if (manual || sent > 0) {
            toastRes(R.string.chat_vm_toast_draft_sent_count, sent)
        }
    }

    private fun startVibingRotation() {
        vibingJob?.cancel()
        vibingJob = viewModelScope.launch {
            while (isActive && _agentState.value.status == "running") {
                _vibingMessage.value = vibingMessages.random()
                delay(3000L)
            }
            _vibingMessage.value = ""
        }
    }

    private fun updateAgentState(newState: AgentHeartbeat) {
        val previousStatus = _agentState.value.status
        _agentState.value = newState
        if (newState.status == "running") {
            if (previousStatus != "running" || vibingJob?.isActive != true) {
                startVibingRotation()
            }
        } else {
            vibingJob?.cancel()
            vibingJob = null
            _vibingMessage.value = ""
        }
    }

    private fun buildRunningTasksPlaceholders(count: Int, agent: String): List<RunningTask> {
        val normalized = count.coerceAtLeast(0)
        if (normalized == 0) return emptyList()
        return (1..normalized).map { idx ->
            RunningTask(taskId = "task_$idx", agent = agent)
        }
    }

    private fun updateTurnState(
        phase: String,
        version: Int = _turnState.value.version,
        reason: String = _turnState.value.reason,
        updatedAt: Long = System.currentTimeMillis(),
        runningTasks: Int = _turnState.value.runningTasks,
        pendingApprovals: Int = _turnState.value.pendingApprovals,
        availableActions: List<String> = _turnState.value.availableActions,
        activeApprovalId: String? = _turnState.value.activeApprovalId,
        riskLevel: String? = _turnState.value.riskLevel,
        riskSummary: String = _turnState.value.riskSummary,
        diffHighlights: List<String> = _turnState.value.diffHighlights,
        lastError: String = _turnState.value.lastError,
    ) {
        _turnState.value = TurnState(
            phase = phase,
            version = version,
            reason = reason,
            updatedAt = updatedAt,
            runningTasks = runningTasks,
            pendingApprovals = pendingApprovals,
            availableActions = availableActions,
            activeApprovalId = activeApprovalId,
            riskLevel = riskLevel,
            riskSummary = riskSummary,
            diffHighlights = diffHighlights,
            lastError = lastError,
        )
        syncWorkflowSnapshotState()
    }

    private fun syncWorkflowSnapshotState() {
        WorkflowSnapshotStore.syncConversationState(
            sessionId = _viewSessionId.value ?: activeSessionId ?: keyStore.sessionId,
            runningTaskCount = _turnState.value.runningTasks,
            pendingApprovalCount = _turnState.value.pendingApprovals,
            activeApprovalId = _turnState.value.activeApprovalId,
            riskLevel = _turnState.value.riskLevel,
            riskSummary = _turnState.value.riskSummary,
            pendingApprovals = pendingApprovals.values.toList(),
            todos = _todos.value,
        )
    }

    private fun loadHistoryItems(sessionId: String): List<ChatItem.Text> {
        return history.loadEntries(sessionId).mapNotNull { entry ->
            if (entry.type == "user" || entry.type == "ai") {
                ChatItem.Text(
                    role = entry.type,
                    content = entry.content,
                    ts = entry.ts.takeIf { it > 0L } ?: System.currentTimeMillis(),
                    taskId = entry.taskId,
                    agent = entry.agent,
                )
            } else {
                null
            }
        }
    }

    private fun persistHistoryFor(sessionId: String, items: List<ChatItem.Text>) {
        history.saveEntries(sessionId, items.map { it.toHistoryEntry() })
    }

    private fun updateCurrentTextTaskId(taskId: String?) {
        currentTextTaskId = normalizeChatTextTaskId(taskId)
    }

    private fun resolveCurrentTextTaskIdForOutgoing(text: String): String? {
        return resolveOutgoingChatTextTaskId(currentTextTaskId, text)
    }

    private fun setViewSession(sessionId: String, persistSelection: Boolean) {
        _viewSessionId.value = sessionId
        _viewingActiveSession.value = sessionId == activeSessionId
        if (persistSelection) keyStore.lastViewedSessionId = sessionId

        val historyItems = loadHistoryItems(sessionId)
        _items.value = historyItems
        updateCurrentTextTaskId(resolveLatestHistoryTaskId(historyItems))
        _streaming.value = false
        _waiting.value = false
        _terminalLines.value = emptyList()
        syncWorkflowSnapshotState()
    }

    /** 从 KeyStore 读取当前查看会话 */
    fun refreshViewSession() {
        val activeId = activeSessionId ?: keyStore.sessionId ?: return
        val preferred = keyStore.lastViewedSessionId ?: activeId
        val target = if (preferred != activeId && history.load(preferred).isEmpty()) activeId else preferred
        if (_viewSessionId.value != target) {
            setViewSession(target, persistSelection = false)
        }
    }

    /** 快速回到当前会话 */
    fun switchToActiveSession() {
        activeSessionId?.let { setViewSession(it, persistSelection = true) }
    }

    private fun requireActiveSession(action: String): Boolean {
        if (_viewingActiveSession.value) return true
        toastRes(R.string.chat_vm_toast_history_readonly_action, action)
        return false
    }

    private fun applySessionSwitch(
        newSessionId: String,
        newToken: String,
        newSharedKey: ByteArray,
        showToast: Boolean,
    ) {
        keyStore.updateSession(newSessionId, newToken, newSharedKey)
        activeSessionId = newSessionId
        processedIds.clear()
        highestSeqBySource.clear()
        seqGapRecoveryScheduled = false
        receivingStream = false
        streamBuffer = StringBuilder()
        streamCommitJob?.cancel()
        streamCommitJob = null
        resetStreamCoordinatorState()
        pendingPrompts.values.forEach { it.timeout?.let { r -> ackHandler.removeCallbacks(r) } }
        pendingPrompts.clear()
        pendingSwitchAckSessionId = null
        switchAckTimeout?.let { ackHandler.removeCallbacks(it) }
        switchAckTimeout = null

        if (history.load(newSessionId).isEmpty()) {
            persistHistoryFor(newSessionId, emptyList())
        }
        setViewSession(newSessionId, persistSelection = true)

        buildSessionGatewayConfig()?.let(sessionGateway::switchSession)

        if (showToast) toastRes(R.string.chat_vm_toast_switched_new_session)
    }

    private fun startSwitchAckWait(sessionId: String) {
        pendingSwitchAckSessionId = sessionId
        switchAckTimeout?.let { ackHandler.removeCallbacks(it) }
        val runnable = Runnable {
            if (pendingSwitchAckSessionId == sessionId) {
                pendingSwitchAckSessionId = null
                toastRes(R.string.chat_vm_toast_switch_ack_timeout)
            }
        }
        switchAckTimeout = runnable
        ackHandler.postDelayed(runnable, switchAckTimeoutMs)
    }

    private fun handleSessionSwitchAck(payload: JSONObject) {
        val sessionId = payload.optString("sessionId")
        val role = payload.optString("role")
        if (sessionId.isBlank()) return
        if (pendingSwitchAckSessionId == sessionId && role == "agent") {
            pendingSwitchAckSessionId = null
            switchAckTimeout?.let { ackHandler.removeCallbacks(it) }
            toastRes(R.string.chat_vm_toast_switch_ack_confirmed)
        }
    }

    private fun queueSessionSwitchAck(sessionId: String) {
        pendingOutboundSwitchAck = sessionId
        flushSessionSwitchAck()
    }

    private fun flushSessionSwitchAck() {
        val targetSessionId = pendingOutboundSwitchAck ?: return
        if (relay?.isConnected != true) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return
        if (sessionId != targetSessionId) return
        val payload = JSONObject()
            .put("sessionId", sessionId)
            .put("deviceId", deviceId)
            .put("role", "app")
            .toString()
        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "session_switch_ack",
            plaintext = payload, sharedKey = key
        ))
        pendingOutboundSwitchAck = null
    }

    /** 远程切换会话（创建新会话或切换到指定会话） */
    fun requestRemoteSessionSwitch(targetSessionId: String?) {
        if (switchingSession) return
        val url = keyStore.serverUrl ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionToken = keyStore.sessionToken ?: return
        val currentSessionId = keyStore.sessionId ?: return
        val sharedKey = keyStore.sharedKey ?: return
        val privateKeyBytes = keyStore.privateKey
        val peerPublicKey = keyStore.peerPublicKey
        if (privateKeyBytes == null || peerPublicKey == null) {
            toastRes(R.string.chat_vm_toast_missing_key_material)
            return
        }
        if (_connState.value != ConnectionState.CONNECTED || relay == null) {
            pendingSessionSwitchId = targetSessionId ?: "__new__"
            toastRes(R.string.chat_vm_toast_waiting_connection_switch)
            return
        }
        if (targetSessionId != null && targetSessionId == activeSessionId) {
            switchToActiveSession()
            return
        }

        switchingSession = true
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val api = ApiClient(url)
                val result = api.switchSession(sessionToken, targetSessionId)
                val newSessionId = result.sessionId
                val newToken = result.tokens[deviceId]
                if (newToken.isNullOrBlank()) {
                    toastRes(R.string.chat_vm_toast_switch_failed_no_token)
                    return@launch
                }

                val payload = JSONObject()
                    .put("sessionId", newSessionId)
                    .put("tokens", JSONObject(result.tokens))
                    .toString()

                // 先通知对端切换（使用旧会话密钥）
                relay?.send(EnvelopeHelper.create(
                    source = deviceId,
                    target = "broadcast",
                    sessionId = currentSessionId,
                    type = "session_switch",
                    plaintext = payload,
                    sharedKey = sharedKey
                ))

                val privateKey = CryptoManager.decodePrivateKey(privateKeyBytes)
                val newSharedKey = CryptoManager.deriveSharedKey(
                    privateKey,
                    peerPublicKey,
                    newSessionId.toByteArray(),
                    CryptoManager.DEFAULT_E2EE_INFO.toByteArray(),
                )

                applySessionSwitch(newSessionId, newToken, newSharedKey, showToast = true)
                startSwitchAckWait(newSessionId)
            } catch (e: Exception) {
                val msg = e.message ?: s(R.string.chat_vm_switch_failed)
                if (!targetSessionId.isNullOrBlank() && msg.contains("session not found")) {
                    setViewSession(targetSessionId, persistSelection = true)
                    toastRes(R.string.chat_vm_toast_remote_session_not_found_open_local)
                } else {
                    toastRes(R.string.chat_vm_toast_switch_failed_with_reason, msg)
                }
            } finally {
                switchingSession = false
            }
        }
    }

    fun confirmHandoffRequest() {
        val handoff = pendingHandoff ?: return
        applySessionSwitch(handoff.sessionId, handoff.token, handoff.sharedKey, showToast = true)
        queueSessionSwitchAck(handoff.sessionId)
        pendingHandoff = null
        _handoffRequest.value = null
        toastRes(R.string.chat_vm_toast_handoff_confirmed, handoff.sessionId.take(12))
    }

    fun rejectHandoffRequest() {
        val handoff = pendingHandoff ?: return
        pendingHandoff = null
        _handoffRequest.value = null
        toastRes(R.string.chat_vm_toast_handoff_rejected, handoff.sessionId.take(12))
    }

    private var streamBuffer = StringBuilder()
    private data class StreamChunk(val text: String, val queuedAtMs: Long)
    private val streamChunkQueue = ArrayDeque<StreamChunk>()
    private val streamChunkLock = Any()
    private var streamCommitJob: Job? = null
    private var streamCatchUpMode = false
    private var streamBelowExitSince = 0L
    private var streamReenterBlockedUntil = 0L

    private val streamTickMs = 16L
    private val streamEnterDepth = 8
    private val streamEnterAgeMs = 120L
    private val streamExitDepth = 2
    private val streamExitAgeMs = 40L
    private val streamExitHoldMs = 250L
    private val streamReenterHoldMs = 250L
    private val streamSevereDepth = 64
    private val streamSevereAgeMs = 300L

    // 会话恢复：已处理消息 id 去重（最近 500 条）
    private val processedIds = LinkedHashSet<String>(500)
    private val highestSeqBySource = mutableMapOf<String, Int>()
    private var wasDisconnected = false
    private val recoveryScope = CoroutineScope(Dispatchers.IO)
    private val refreshScope = CoroutineScope(Dispatchers.IO)
    @Volatile
    private var recoveringMissedMessages = false
    @Volatile
    private var seqGapRecoveryScheduled = false

    /** 解析 JWT payload 中的 exp（秒级时间戳） */
    private fun parseJwtExp(token: String): Long? {
        return try {
            val parts = token.split(".")
            if (parts.size != 3) return null
            val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING))
            val obj = JSONObject(payload)
            if (obj.has("exp")) obj.getLong("exp") else null
        } catch (_: Exception) { null }
    }

    /** 检查并刷新 token */
    private fun checkAndRefreshToken() {
        val url = keyStore.serverUrl ?: return
        val token = keyStore.sessionToken ?: return
        val exp = parseJwtExp(token) ?: return

        val remainingSec = exp - System.currentTimeMillis() / 1000
        if (remainingSec > 2 * 3600) return // 剩余 > 2h，无需刷新

        refreshScope.launch {
            try {
                val api = ApiClient(url)
                val newToken = api.refreshToken(token)
                if (newToken != null) {
                    keyStore.updateSessionToken(newToken)
                    relayTokenInvalid = false
                    // 断开旧连接，用新 token 重连
                    sessionGateway.disconnect()
                    connect()
                    refreshRecoveryIssues()
                }
            } catch (_: Exception) {
                toastRes(R.string.chat_vm_toast_token_refresh_failed)
                refreshRecoveryIssues()
            }
        }
    }

    fun recoverTokenInvalid() {
        val url = keyStore.serverUrl
        val token = keyStore.sessionToken
        if (url.isNullOrBlank() || token.isNullOrBlank()) {
            toastRes(R.string.chat_vm_toast_missing_session_refresh_token)
            return
        }
        refreshScope.launch {
            val newToken = runCatching { ApiClient(url).refreshToken(token) }.getOrNull()
            if (newToken.isNullOrBlank()) {
                relayTokenInvalid = true
                toastRes(R.string.chat_vm_toast_token_refresh_failed_check_pairing)
                refreshRecoveryIssues()
                return@launch
            }
            keyStore.updateSessionToken(newToken)
            relayTokenInvalid = false
            toastRes(R.string.chat_vm_toast_token_refreshed_reconnecting)
            reconnectNow()
            refreshRecoveryIssues()
        }
    }

    /** 启动 token 定时刷新（每 30 分钟检查） */
    private fun startTokenRefreshTimer() {
        refreshScope.launch {
            while (true) {
                delay(30 * 60 * 1000L)
                checkAndRefreshToken()
            }
        }
    }

    fun connect() {
        if (relay != null) return
        _preferredConnectionMode.value = LocalConnectionPrefs.mode
        val config = buildSessionGatewayConfig() ?: return
        activeSessionId = config.sessionId

        // 加载历史对话（优先恢复上次查看）
        val preferred = keyStore.lastViewedSessionId ?: config.sessionId
        val target = if (preferred != config.sessionId && history.load(preferred).isEmpty()) config.sessionId else preferred
        setViewSession(target, persistSelection = false)

        // 启动 token 定时刷新（仅一次）
        if (!tokenRefreshStarted) {
            startTokenRefreshTimer()
            tokenRefreshStarted = true
        }
        // 启动时也检查一次
        checkAndRefreshToken()
        refreshRecoveryIssues()

        sessionGateway.connect(config)
    }

    fun reconnectNow() {
        sessionGateway.disconnect()
        _connState.value = ConnectionState.DISCONNECTED
        agentOfflineIssue = true
        refreshRecoveryIssues()
        connect()
    }

    fun recoverAgentOffline() {
        toastRes(R.string.chat_vm_toast_recovering_agent_connection)
        reconnectNow()
        viewModelScope.launch {
            delay(800L)
            probeForeground("recover_agent_offline")
        }
    }

    fun recoverPushDisabled() {
        val url = keyStore.serverUrl
        val sessionToken = keyStore.sessionToken
        if (url.isNullOrBlank() || sessionToken.isNullOrBlank()) {
            toastRes(R.string.chat_vm_toast_missing_session_fix_push)
            return
        }
        if (!NotificationPrefs.approvalEnabled) {
            NotificationPrefs.approvalEnabled = true
        }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                pushRegistrationHealthy = false
                toastRes(R.string.chat_vm_toast_fetch_push_token_failed)
                refreshRecoveryIssues()
                return@addOnCompleteListener
            }
            val fcmToken = task.result?.trim().orEmpty()
            if (fcmToken.isBlank()) {
                pushRegistrationHealthy = false
                toastRes(R.string.chat_vm_toast_push_token_empty)
                refreshRecoveryIssues()
                return@addOnCompleteListener
            }
            keyStore.fcmToken = fcmToken
            if (relay?.isConnected == true) {
                sessionGateway.registerPushToken(fcmToken)
            }
            viewModelScope.launch(Dispatchers.IO) {
                val ok = runCatching { ApiClient(url).registerPushToken(sessionToken, fcmToken) }.getOrDefault(false)
                if (ok) {
                    pushRegistrationHealthy = true
                    toastRes(R.string.chat_vm_toast_push_channel_restored)
                } else {
                    pushRegistrationHealthy = false
                    toastRes(R.string.chat_vm_toast_push_register_failed)
                }
                refreshRecoveryIssues()
            }
        }
    }

    fun recoverIssue(type: RecoveryIssueType) {
        when (type) {
            RecoveryIssueType.AGENT_OFFLINE -> recoverAgentOffline()
            RecoveryIssueType.TOKEN_INVALID -> recoverTokenInvalid()
            RecoveryIssueType.PUSH_DISABLED -> recoverPushDisabled()
        }
    }

    fun switchPreferredConnectionMode() {
        val current = LocalConnectionPrefs.mode
        val target = when (current) {
            ConnectionMode.LOCAL -> ConnectionMode.RELAY
            ConnectionMode.RELAY -> ConnectionMode.LOCAL
            ConnectionMode.AUTO -> {
                if (_connectionType.value == "local") ConnectionMode.RELAY else ConnectionMode.LOCAL
            }
        }
        LocalConnectionPrefs.mode = target
        _preferredConnectionMode.value = target
        toastRes(
            R.string.chat_vm_toast_connection_pref_switched_to,
            getApplication<Application>().getString(target.labelRes),
        )
        reconnectNow()
    }

    private fun buildSessionGatewayConfig(): SessionGatewayConfig? {
        val serverUrl = keyStore.serverUrl ?: return null
        val sessionToken = keyStore.sessionToken ?: return null
        val sessionId = keyStore.sessionId ?: return null
        return SessionGatewayConfig(
            serverUrl = serverUrl,
            sessionToken = sessionToken,
            sessionId = sessionId,
            preferredConnectionMode = LocalConnectionPrefs.mode,
            manualIp = LocalConnectionPrefs.manualIp,
            manualPort = LocalConnectionPrefs.manualPort,
            deviceId = keyStore.deviceId,
            localAuthKeyBytes = deriveLocalAuthKey(),
        )
    }

    private fun buildSessionGatewayCallbacks(): SessionGatewayCallbacks = SessionGatewayCallbacks(
        onConnectionTypeChange = { type ->
            _connectionType.value = type
        },
        onStateChange = { state ->
            _connState.value = state
            when (_connectionType.value) {
                "local" -> {
                    if (state == ConnectionState.CONNECTED) {
                        agentOfflineIssue = false
                        relayTokenInvalid = false
                        flushPendingDrafts()
                        refreshSessionControl()
                    }
                    if (state == ConnectionState.DISCONNECTED) {
                        agentOfflineIssue = true
                    }
                }
                else -> {
                    if (state == ConnectionState.CONNECTED) {
                        relayTokenInvalid = false
                        agentOfflineIssue = false
                        val url = keyStore.serverUrl
                        val token = keyStore.sessionToken
                        val fcm = keyStore.fcmToken
                        if (!url.isNullOrBlank() && !token.isNullOrBlank() && !fcm.isNullOrBlank()) {
                            registerPushTokenOnConnect(url, token, fcm)
                        }
                        pendingSessionSwitchId?.let { pending ->
                            pendingSessionSwitchId = null
                            val target = if (pending == "__new__") null else pending
                            requestRemoteSessionSwitch(target)
                        }
                        flushSessionSwitchAck()
                        flushPendingDrafts()
                        if (wasDisconnected) {
                            wasDisconnected = false
                            recoverMissedMessages()
                        }
                        refreshSessionControl()
                    }
                    if (state == ConnectionState.DISCONNECTED) {
                        wasDisconnected = true
                        agentOfflineIssue = true
                    }
                }
            }
            refreshRecoveryIssues()
        },
        onMessage = ::handleEnvelope,
        onAck = ::handleAck,
        onDeviceOnline = {
            agentOfflineIssue = false
            toastRes(R.string.chat_vm_toast_agent_online)
            Notifier.agentStatus(
                getApplication(),
                s(R.string.chat_vm_notify_agent_online_title),
                s(R.string.chat_vm_notify_agent_online_body),
            )
            refreshRecoveryIssues()
        },
        onDeviceOffline = {
            agentOfflineIssue = true
            toastRes(R.string.chat_vm_toast_agent_offline)
            Notifier.agentStatus(
                getApplication(),
                s(R.string.chat_vm_notify_agent_offline_title),
                s(R.string.chat_vm_notify_agent_offline_body),
            )
            refreshRecoveryIssues()
        },
        onDeviceList = { arr ->
            val list = mutableListOf<ConnectedDevice>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(ConnectedDevice(obj.getString("deviceId"), obj.getString("role")))
            }
            _devices.value = list
            val hasAgent = list.any { it.role == "agent" }
            agentOfflineIssue = !hasAgent
            refreshRecoveryIssues()
        },
        onError = { error ->
            when {
                error == SESSION_GATEWAY_ERROR_LOCAL_UNAVAILABLE_MISSING_KEY -> {
                    _connState.value = ConnectionState.DISCONNECTED
                    toastRes(R.string.chat_vm_toast_local_unavailable_missing_key)
                }
                _connectionType.value == "local" -> {
                    toastRes(R.string.chat_vm_toast_local_connection_error, error)
                }
                else -> {
                    if (inferTokenInvalid(error)) {
                        relayTokenInvalid = true
                    }
                    toastRes(R.string.chat_vm_toast_connection_error, error)
                }
            }
            refreshRecoveryIssues()
        },
    )

    private fun deriveLocalAuthKey(): ByteArray? {
        val privateKeyBytes = keyStore.privateKey ?: return null
        val peerPublicKey = keyStore.peerPublicKey ?: return null
        val sessionId = keyStore.sessionId ?: return null
        return runCatching {
            CryptoManager.deriveSharedKey(
                privateKey = CryptoManager.decodePrivateKey(privateKeyBytes),
                peerPublic = peerPublicKey,
                salt = sessionId.toByteArray(),
                info = LocalRelayClient.LOCAL_HMAC_INFO.toByteArray(),
            )
        }.getOrNull()
    }

    private fun registerPushTokenOnConnect(url: String, sessionToken: String, fcmToken: String) {
        if (relay == null) return
        sessionGateway.registerPushToken(fcmToken)
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { ApiClient(url).registerPushToken(sessionToken, fcmToken) }
                .onSuccess { ok ->
                    pushRegistrationHealthy = ok
                    refreshRecoveryIssues()
                }
                .onFailure { e ->
                    pushRegistrationHealthy = false
                    refreshRecoveryIssues()
                    Log.w("ChatViewModel", "push register fallback failed: ${e.message}")
                }
        }
    }

    private fun sendInboundAckIfRequired(type: String, env: JSONObject, messageId: String) {
        if (!inboundAckRequiredTypes.contains(type)) return
        if (messageId.isBlank()) return
        val source = env.optString("source")
        val localDeviceId = keyStore.deviceId ?: return
        if (source == localDeviceId) return
        val ackSessionId = env.optString("sessionId").ifBlank { keyStore.sessionId ?: return }
        sessionGateway.sendAck(
            messageId = messageId,
            source = localDeviceId,
            sessionId = ackSessionId,
            state = RelayAckState.WORKING,
        )
    }

    private fun handleEnvelope(env: JSONObject) {
        val activeId = activeSessionId ?: return
        val viewingActive = _viewSessionId.value == activeId
        val type = env.optString("type")
        val msgId = env.optString("id", "")
        sendInboundAckIfRequired(type, env, msgId)

        // 按 id 去重（防止重连恢复时重复处理）
        if (msgId.isNotEmpty()) {
            if (processedIds.contains(msgId)) return
            processedIds.add(msgId)
            // 保持集合大小 ≤ 500
            if (processedIds.size > 500) {
                processedIds.iterator().let { it.next(); it.remove() }
            }
        }
        val key = keyStore.sharedKey ?: return
        val payload = EnvelopeHelper.decryptPayload(env, key)
        observeInboundSeqAndMaybeRecover(env)

        // 更新 lastSeenTs 用于会话恢复
        val ts = env.optLong("ts", 0L)
        val relayTs = env.optLong("relayTs", 0L)
        val seenTs = maxOf(ts, relayTs)
        if (seenTs > keyStore.lastSeenTs) keyStore.lastSeenTs = seenTs
        val cursor = env.optLong("cursor", 0L)
        if (cursor > keyStore.lastSeenCursor) keyStore.lastSeenCursor = cursor
        val parseContext = AgentParseContext(
            envelopeId = msgId.takeIf { it.isNotBlank() },
            fallbackAgent = _agentState.value.agent,
            currentStatus = _agentState.value.status,
            currentProjectPath = _agentState.value.projectPath,
            currentRunningTasks = _turnState.value.runningTasks,
            currentPendingApprovals = _turnState.value.pendingApprovals,
            currentTurnVersion = _turnState.value.version,
            currentTurnReason = _turnState.value.reason,
            currentPermissionMode = _agentState.value.permissionMode.value,
            currentModelMode = _agentState.value.modelMode.value,
        )

        when (type) {
            "session_switch" -> {
                val obj = JSONObject(payload)
                val newSessionId = obj.optString("sessionId")
                val tokens = obj.optJSONObject("tokens")
                val myToken = tokens?.optString(keyStore.deviceId ?: "", "")
                val privateKeyBytes = keyStore.privateKey
                val peerPublicKey = keyStore.peerPublicKey
                if (newSessionId.isNotBlank() && !myToken.isNullOrBlank()
                    && privateKeyBytes != null && peerPublicKey != null
                ) {
                    val privateKey = CryptoManager.decodePrivateKey(privateKeyBytes)
                    val newSharedKey = CryptoManager.deriveSharedKey(
                        privateKey,
                        peerPublicKey,
                        newSessionId.toByteArray(),
                        CryptoManager.DEFAULT_E2EE_INFO.toByteArray(),
                    )
                    val sourceDeviceId = env.optString("source").takeIf { it.isNotBlank() }
                    val reason = obj.optString("reason").takeIf { it.isNotBlank() }
                    pendingHandoff = PendingHandoff(
                        sessionId = newSessionId,
                        token = myToken,
                        sharedKey = newSharedKey,
                        sourceDeviceId = sourceDeviceId,
                        reason = reason,
                    )
                    _handoffRequest.value = HandoffRequest(
                        sessionId = newSessionId,
                        sourceDeviceId = sourceDeviceId,
                        reason = reason,
                        requestedAt = System.currentTimeMillis(),
                    )
                    toastRes(R.string.chat_vm_toast_handoff_request_received)
                } else {
                    toastRes(R.string.chat_vm_toast_switch_failed_missing_key_or_token)
                }
                return
            }
            "session_switch_ack" -> {
                handleSessionSwitchAck(JSONObject(payload))
                return
            }
            "stream_chunk" -> {
                if (!receivingStream) {
                    receivingStream = true
                    if (viewingActive) _streaming.value = true
                    streamBuffer = StringBuilder()
                    resetStreamCoordinatorState()
                    clearEphemeralThinkingItems()
                    val wasWaiting = _waiting.value
                    // 收到首个 chunk → 结束等待状态 + 记录延迟
                    if (wasWaiting) {
                        if (viewingActive) _waiting.value = false
                        val latency = System.currentTimeMillis() - sendTimestamp
                        Log.d("Yuanio", "[chat] send_to_first_chunk: ${latency}ms")
                    }
                    // 首个 chunk → 标记消息已读
                    updateLastUserDelivery(DeliveryStatus.READ)
                    // ACK 丢失时，收到首个 chunk 视为成功送达（仅单一待确认场景）
                    if (pendingPrompts.size == 1) {
                        val only = pendingPrompts.entries.first()
                        clearPending(only.key)
                    }
                }
                enqueueStreamChunk(payload)
            }
            "stream_end" -> {
                receivingStream = false
                flushQueuedStreamChunks()
                clearEphemeralThinkingItems()
                val finalText = (agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.StreamEnd)?.finalText
                if (!finalText.isNullOrBlank()) {
                    val current = streamBuffer.toString()
                    // 若发生丢 chunk/重连恢复，finalText 可兜底覆盖，保证结果完整。
                    if (current.isBlank() || finalText.length >= current.length) {
                        streamBuffer = StringBuilder(finalText)
                    }
                }
                if (viewingActive) {
                    _streaming.value = false
                    _waiting.value = false
                    updateStreamMessage()
                    persistHistory()
                    _terminalLines.value = emptyList()
                    // 自动朗读
                    if (TtsPrefs.autoRead) {
                        val lastAi = _items.value.lastOrNull { it is ChatItem.Text && it.role == "ai" }
                        if (lastAi is ChatItem.Text) {
                            val idx = _items.value.indexOf(lastAi)
                            speak(lastAi.content, idx)
                        }
                    }
                    // Auto-Pilot：延迟 2s 后自动续发
                    if (_autoPilot.value.enabled) {
                        viewModelScope.launch {
                            delay(2000)
                            autoPilotContinue()
                        }
                    }
                } else {
                    val items = loadHistoryItems(activeId).toMutableList()
                    val content = NoiseFilter.clean(streamBuffer.toString())
                    val currentAgent = _agentState.value.agent
                    val taskId = currentTextTaskId
                    val last = items.lastOrNull()
                    if (last != null && last.role == "ai") {
                        items[items.lastIndex] = last.copy(
                            content = content,
                            taskId = last.taskId ?: taskId,
                            agent = currentAgent ?: last.agent,
                        )
                    } else {
                        items.add(ChatItem.Text("ai", content, taskId = taskId, agent = currentAgent))
                    }
                    updateCurrentTextTaskId(taskId)
                    persistHistoryFor(activeId, items)
                    toastRes(R.string.chat_vm_toast_current_session_new_message)
                }
                streamBuffer = StringBuilder()
            }
            "terminal_output" -> {
                if (viewingActive) {
                    val lines = _terminalLines.value.toMutableList()
                    lines.add(payload)
                    if (lines.size > 200) lines.removeAt(0)
                    _terminalLines.value = lines
                }
            }
            "thinking" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.Thinking ?: return
                val thinkingItem = event.item
                val itemAgent = thinkingItem.agent
                if (viewingActive) {
                    val ephemeral = thinkingItem.ephemeral
                    val done = event.done
                    val turnId = thinkingItem.turnId
                    if (ephemeral && done) {
                        val items = _items.value.toMutableList()
                        val existingIdx = if (turnId != null) {
                            items.indexOfLast {
                                it is ChatItem.Thinking && it.turnId == turnId && it.ephemeral
                            }
                        } else {
                            items.indexOfLast { it is ChatItem.Thinking && it.ephemeral }
                        }
                        if (existingIdx >= 0) {
                            items.removeAt(existingIdx)
                            _items.value = items
                        }
                        return
                    }
                    val thinking = thinkingItem.content
                    if (thinking.isNotBlank()) {
                        val items = _items.value.toMutableList()
                        val existingIdx = if (turnId != null) {
                            items.indexOfLast {
                                it is ChatItem.Thinking && it.turnId == turnId
                            }
                        } else {
                            items.indexOfLast {
                                it is ChatItem.Thinking && it.ephemeral == ephemeral
                            }
                        }
                        if (existingIdx >= 0) {
                            val existing = items[existingIdx] as ChatItem.Thinking
                            items[existingIdx] = existing.copy(
                                content = thinking,
                                ephemeral = ephemeral,
                                done = done,
                                phase = thinkingItem.phase,
                                elapsedMs = thinkingItem.elapsedMs,
                                agent = itemAgent,
                            )
                            _items.value = items
                        } else {
                            addItem(thinkingItem)
                        }
                    }
                }
            }
            "tool_call" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.ToolCall ?: return
                val itemAgent = event.item.agent
                val status = event.item.status
                val toolUseId = event.item.toolUseId
                if (viewingActive) {
                    if (status.isTerminal) {
                        val toolName = event.item.tool
                        val result = event.item.result
                        val items = _items.value.toMutableList()
                        val idx = if (toolUseId != null) {
                            items.indexOfLast { it is ChatItem.ToolCall && it.toolUseId == toolUseId }
                        } else {
                            items.indexOfLast { it is ChatItem.ToolCall && it.status.isInFlight && it.tool == toolName }
                        }
                        if (idx >= 0) {
                            val existing = items[idx] as ChatItem.ToolCall
                            items[idx] = existing.copy(status = status, result = result)
                            _items.value = items
                        } else {
                            addItem(
                                ChatItem.ToolCall(
                                    tool = toolName,
                                    status = status,
                                    result = result,
                                    summary = event.item.summary,
                                    toolUseId = toolUseId,
                                    agent = itemAgent,
                                )
                            )
                        }
                    } else {
                        addItem(
                            ChatItem.ToolCall(
                                tool = event.item.tool,
                                status = status,
                                result = null,
                                summary = event.paramsSummary,
                                toolUseId = toolUseId,
                                agent = itemAgent,
                            )
                        )
                    }
                }
            }
            "usage_report" -> {
                if (viewingActive) {
                    val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.UsageReport
                    if (event != null) {
                        val info = event.item
                        info.taskId?.let { taskId ->
                            WorkflowSnapshotStore.upsertTaskUsage(
                                taskId = taskId,
                                inputTokens = info.inputTokens,
                                outputTokens = info.outputTokens,
                                cacheCreationTokens = info.cacheCreationTokens,
                                cacheReadTokens = info.cacheReadTokens,
                            )
                        }
                        val taskId = info.taskId
                        val items = _items.value.toMutableList()
                        val existingIdx = items.indexOfLast {
                            it is ChatItem.UsageInfo && it.taskId == taskId
                        }
                        if (existingIdx >= 0) {
                            items[existingIdx] = info
                            _items.value = items
                        } else {
                            _items.value = items + info
                        }
                    }
                }
            }
            "task_queue_status" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.TaskQueueStatusUpdate ?: return
                WorkflowSnapshotStore.syncTaskQueueStatus(
                    queuedTasks = event.queued.map {
                        WorkflowQueuedTask(
                            id = it.id,
                            prompt = it.prompt,
                            agent = it.agent,
                            priority = it.priority,
                            createdAt = it.createdAt,
                        )
                    },
                    runningTaskIds = event.running,
                    queueMode = event.mode,
                )
            }
            "task_summary" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.TaskSummaryUpdate ?: return
                if (event.taskId.isNotBlank()) {
                    WorkflowSnapshotStore.upsertTaskSummary(
                        WorkflowTaskSummary(
                            taskId = event.taskId,
                            durationMs = event.durationMs,
                            gitStat = event.gitStat,
                            filesChanged = event.filesChanged,
                            insertions = event.insertions,
                            deletions = event.deletions,
                            inputTokens = event.inputTokens,
                            outputTokens = event.outputTokens,
                            cacheCreationTokens = event.cacheCreationTokens,
                            cacheReadTokens = event.cacheReadTokens,
                            updatedAt = System.currentTimeMillis(),
                        )
                    )
                }
            }
            "file_diff" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.FileDiff ?: return
                if (viewingActive) {
                    addItem(event.item)
                }
            }
            "diff_action_result" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.DiffActionResult ?: return
                val path = event.path
                val action = event.action
                val success = event.success
                val error = event.error
                if (success) {
                    _items.value = _items.value.filterNot {
                        it is ChatItem.FileDiff && it.path == path
                    }
                    toastText = when (action) {
                        "rollback" -> s(R.string.chat_vm_toast_diff_rolled_back, path)
                        "accept" -> s(R.string.chat_vm_toast_diff_accepted, path)
                        else -> s(R.string.chat_vm_toast_diff_processed, path)
                    }
                } else {
                    toastRes(R.string.chat_vm_toast_diff_process_failed, error ?: path)
                }
            }
            "status" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.StatusUpdate ?: return
                val status = event.status
                val project = event.projectPath
                val runningTasks = event.runningTasks
                val pendingApprovals = event.pendingApprovals
                val reason = event.reason
                val version = event.version
                val updatedAt = event.updatedAt
                val current = _agentState.value
                updateAgentState(current.copy(
                    status = status,
                    projectPath = project ?: current.projectPath,
                    lastSeen = System.currentTimeMillis(),
                    runningTasks = buildRunningTasksPlaceholders(runningTasks, current.agent)
                ))
                updateTurnState(
                    phase = status,
                    version = version,
                    reason = reason,
                    updatedAt = updatedAt,
                    runningTasks = runningTasks,
                    pendingApprovals = pendingApprovals
                )
            }
            "heartbeat" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.HeartbeatUpdate ?: return
                val status = event.status
                val project = event.projectPath
                val tasks = event.runningTasks.map { RunningTask(it.taskId, it.agent) }
                val mode = PermissionMode.fromValue(event.permissionMode)
                val mMode = ModelMode.fromValue(event.modelMode)
                val metaVer = event.metadataVersion
                updateAgentState(AgentHeartbeat(
                    status = status,
                    uptime = event.uptime,
                    projectPath = project,
                    agent = event.agent,
                    lastSeen = System.currentTimeMillis(),
                    runningTasks = tasks,
                    permissionMode = mode,
                    metadataVersion = metaVer,
                    modelMode = mMode
                ))
                updateTurnState(
                    phase = status,
                    version = event.turnStateVersion,
                    reason = event.turnStateReason,
                    updatedAt = System.currentTimeMillis(),
                    runningTasks = tasks.size,
                    pendingApprovals = _turnState.value.pendingApprovals
                )
                val label = when (status) {
                    "running" -> s(R.string.chat_vm_agent_widget_running)
                    "idle" -> s(R.string.chat_vm_agent_widget_idle)
                    "error" -> s(R.string.chat_vm_agent_widget_error)
                    else -> s(R.string.chat_vm_agent_widget_status_generic, status)
                }
                AgentWidget.refresh(getApplication(), label, project)
            }
            "turn_state" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.TurnStateUpdate ?: return
                val phase = event.phase
                val runningTasks = event.runningTasks
                val pendingApprovals = event.pendingApprovals
                updateTurnState(
                    phase = phase,
                    version = event.version,
                    reason = event.reason,
                    updatedAt = event.updatedAt,
                    runningTasks = runningTasks,
                    pendingApprovals = pendingApprovals
                )
                val current = _agentState.value
                updateAgentState(current.copy(
                    status = phase,
                    lastSeen = System.currentTimeMillis(),
                    runningTasks = buildRunningTasksPlaceholders(runningTasks, current.agent)
                ))
            }
            "interaction_state" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.InteractionStateUpdate ?: return
                val phase = event.phase
                val runningTasks = event.runningTasks
                val pendingApprovals = event.pendingApprovals
                updateTurnState(
                    phase = phase,
                    version = event.version,
                    reason = event.reason,
                    updatedAt = event.updatedAt,
                    runningTasks = runningTasks,
                    pendingApprovals = pendingApprovals,
                    availableActions = if (event.availableActions.isNotEmpty()) event.availableActions else _turnState.value.availableActions,
                    activeApprovalId = event.activeApprovalId,
                    riskLevel = event.riskLevel,
                    riskSummary = event.riskSummary,
                    diffHighlights = event.diffHighlights,
                    lastError = event.lastError,
                )
                val current = _agentState.value
                updateAgentState(current.copy(
                    status = phase,
                    lastSeen = System.currentTimeMillis(),
                    runningTasks = buildRunningTasksPlaceholders(runningTasks, current.agent)
                ))
            }
            "replay_done" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.ReplayDone ?: return
                val replayed = event.replayed.coerceAtLeast(0)
                val replay = ReplayState(
                    sessionId = event.sessionId,
                    replayed = replayed,
                    daemonCached = event.daemonCached.coerceAtLeast(0),
                    rounds = event.rounds.coerceAtLeast(0),
                    reason = event.reason,
                    at = event.at.takeIf { it > 0L } ?: System.currentTimeMillis()
                )
                _replayState.value = replay
                if (replayed > 0) {
                    toastRes(R.string.chat_vm_toast_replayed_messages, replayed, replay.reason)
                }
            }
            "foreground_probe_ack" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.ForegroundProbeAck ?: return
                val now = System.currentTimeMillis()
                val probeId = event.probeId
                val clientTs = event.clientTs
                val latency = when {
                    clientTs > 0L -> (now - clientTs).coerceAtLeast(0L)
                    probeId != null && probeId == pendingProbeId && pendingProbeSentAtMs > 0L ->
                        (now - pendingProbeSentAtMs).coerceAtLeast(0L)
                    else -> null
                }
                if (probeId != null && probeId == pendingProbeId) {
                    pendingProbeId = null
                    pendingProbeSentAtMs = 0L
                }
                val status = event.status
                val cwd = event.cwd
                val runningTasks = event.runningTasks
                val pendingApprovals = event.pendingApprovals
                val turnStateVersion = event.turnStateVersion
                val turnStateReason = event.turnStateReason
                val mode = PermissionMode.fromValue(event.permissionMode)
                val model = ModelMode.fromValue(event.modelMode)
                val current = _agentState.value
                updateAgentState(current.copy(
                    status = status,
                    projectPath = cwd ?: current.projectPath,
                    lastSeen = now,
                    runningTasks = buildRunningTasksPlaceholders(runningTasks, current.agent),
                    permissionMode = mode,
                    modelMode = model
                ))
                updateTurnState(
                    phase = status,
                    version = turnStateVersion,
                    reason = turnStateReason,
                    updatedAt = now,
                    runningTasks = runningTasks,
                    pendingApprovals = pendingApprovals
                )
                _foregroundProbe.value = ForegroundProbeState(
                    status = status,
                    latencyMs = latency,
                    lastAckAt = now,
                    cwd = cwd,
                    runningTasks = runningTasks,
                    pendingApprovals = pendingApprovals,
                    turnStateVersion = turnStateVersion,
                    turnStateReason = turnStateReason
                )
            }
            "rpc_resp" -> {
                val obj = JSONObject(payload)
                _rpcResult.value = obj
                // Shell 回退模式：将 shell_exec 结果显示为聊天消息
                val rpcId = obj.optString("id")
                pendingRpcCallbacks.remove(rpcId)?.invoke(obj)
                pendingShellRpc.remove(rpcId)?.let {
                    val result = obj.optJSONObject("result")
                    val error = obj.optString("error").takeIf { e -> e.isNotBlank() }
                    val output = if (error != null) {
                        "❌ $error"
                    } else if (result != null) {
                        // agent_command 返回 { output }，shell_exec 返回 { stdout, stderr, exitCode }
                        val directOutput = result.optString("output", "").trimEnd()
                        if (directOutput.isNotBlank()) {
                            directOutput
                        } else {
                            val stdout = result.optString("stdout", "").trimEnd()
                            val stderr = result.optString("stderr", "").trimEnd()
                            val code = result.optInt("exitCode", 0)
                            buildString {
                                if (stdout.isNotBlank()) append(stdout)
                                if (stderr.isNotBlank()) {
                                    if (isNotBlank()) append("\n")
                                    append("⚠️ $stderr")
                                }
                                if (code != 0) append("\n(exit $code)")
                            }.ifBlank { "(no output)" }
                        }
                    } else "(no output)"
                    addItem(ChatItem.Text("ai", "```\n$output\n```", taskId = currentTextTaskId, agent = "shell"))
                }
            }
            "hook_event" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.HookEvent ?: return
                if (viewingActive) {
                    addItem(event.item)
                }
            }
            "approval_req" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.ApprovalRequest ?: return
                val approval = event.item
                // 优先从 payload 读取 id（审批服务器生成），回退到 envelope id
                addItem(approval)
                _urgentApproval.value = approval
                pendingApprovals[approval.id] = approval
                syncApprovalQueueState()
                scheduleAutoRejectIfNeeded(approval)
                Notifier.approval(getApplication(), approval.desc, approval.id)
                updateTurnState(
                    phase = "waiting_approval",
                    pendingApprovals = pendingApprovals.size,
                    activeApprovalId = approval.id,
                    riskLevel = approval.riskLevel,
                    riskSummary = approval.riskSummary,
                    diffHighlights = approval.diffHighlights,
                )
            }
            "todo_update" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.TodoUpdate
                if (event != null) {
                    _todos.value = event.item.todos
                    syncWorkflowSnapshotState()
                    if (viewingActive) {
                        addItem(event.item)
                    }
                }
            }
            "model_mode" -> {
                val event = agentEventParser.parse(type, payload, parseContext) as? ParsedAgentEvent.ModelModeUpdate ?: return
                val mode = ModelMode.fromValue(event.modeValue)
                updateAgentState(_agentState.value.copy(modelMode = mode))
            }
        }
    }

    private fun observeInboundSeqAndMaybeRecover(env: JSONObject) {
        val source = env.optString("source").takeIf { it.isNotBlank() } ?: return
        val seq = env.optInt("seq", 0)
        if (seq <= 0) return

        val previous = highestSeqBySource[source] ?: 0
        if (seq > previous + 1) {
            Log.w("Yuanio", "[chat] inbound seq gap source=$source expected>${previous + 1} got=$seq")
            scheduleSeqGapRecovery()
        }
        if (seq > previous) {
            highestSeqBySource[source] = seq
        }
    }

    private fun scheduleSeqGapRecovery() {
        if (seqGapRecoveryScheduled) return
        seqGapRecoveryScheduled = true
        viewModelScope.launch {
            delay(180)
            seqGapRecoveryScheduled = false
            recoverMissedMessages()
        }
    }

    private fun resetStreamCoordinatorState() {
        synchronized(streamChunkLock) {
            streamChunkQueue.clear()
            streamCatchUpMode = false
            streamBelowExitSince = 0L
            streamReenterBlockedUntil = 0L
        }
    }

    private fun enqueueStreamChunk(chunk: String) {
        synchronized(streamChunkLock) {
            streamChunkQueue.addLast(StreamChunk(chunk, System.currentTimeMillis()))
        }
        ensureStreamCommitLoop()
    }

    private fun ensureStreamCommitLoop() {
        if (streamCommitJob?.isActive == true) return
        streamCommitJob = viewModelScope.launch {
            while (true) {
                val drained = drainQueuedChunksForTick(System.currentTimeMillis())
                if (drained > 0 && _viewSessionId.value == activeSessionId) {
                    updateStreamMessage()
                }

                val shouldContinue = synchronized(streamChunkLock) {
                    receivingStream || streamChunkQueue.isNotEmpty()
                }
                if (!shouldContinue) break
                delay(streamTickMs)
            }
            streamCommitJob = null
        }
    }

    private fun drainQueuedChunksForTick(nowMs: Long): Int {
        synchronized(streamChunkLock) {
            if (streamChunkQueue.isEmpty()) {
                streamCatchUpMode = false
                streamBelowExitSince = 0L
                return 0
            }

            val oldestAgeMs = nowMs - (streamChunkQueue.peekFirst()?.queuedAtMs ?: nowMs)
            val shouldEnterCatchUp = streamChunkQueue.size >= streamEnterDepth || oldestAgeMs >= streamEnterAgeMs
            val severeBacklog = streamChunkQueue.size >= streamSevereDepth || oldestAgeMs >= streamSevereAgeMs

            if (!streamCatchUpMode && shouldEnterCatchUp) {
                if (nowMs >= streamReenterBlockedUntil || severeBacklog) {
                    streamCatchUpMode = true
                    streamBelowExitSince = 0L
                    streamReenterBlockedUntil = 0L
                }
            } else if (streamCatchUpMode) {
                val belowExit = streamChunkQueue.size <= streamExitDepth && oldestAgeMs <= streamExitAgeMs
                if (belowExit) {
                    if (streamBelowExitSince == 0L) {
                        streamBelowExitSince = nowMs
                    } else if (nowMs - streamBelowExitSince >= streamExitHoldMs) {
                        streamCatchUpMode = false
                        streamBelowExitSince = 0L
                        streamReenterBlockedUntil = nowMs + streamReenterHoldMs
                    }
                } else {
                    streamBelowExitSince = 0L
                }
            }

            val drainCount = if (streamCatchUpMode) streamChunkQueue.size else 1
            var drained = 0
            repeat(drainCount) {
                val next = streamChunkQueue.pollFirst() ?: return@repeat
                streamBuffer.append(next.text)
                drained += 1
            }
            return drained
        }
    }

    private fun flushQueuedStreamChunks() {
        var drained = 0
        synchronized(streamChunkLock) {
            while (streamChunkQueue.isNotEmpty()) {
                val next = streamChunkQueue.pollFirst() ?: break
                streamBuffer.append(next.text)
                drained += 1
            }
            streamCatchUpMode = false
            streamBelowExitSince = 0L
            streamReenterBlockedUntil = 0L
        }
        if (drained > 0 && _viewSessionId.value == activeSessionId) {
            updateStreamMessage()
        }
    }

    private fun updateStreamMessage() {
        val content = NoiseFilter.clean(streamBuffer.toString())
        val taskId = currentTextTaskId
        val merged = mergeStreamingChatText(
            current = _items.value,
            content = content,
            currentAgent = _agentState.value.agent,
            currentTaskId = taskId,
        )
        updateCurrentTextTaskId(taskId)
        _items.value = merged
    }

    private fun clearEphemeralThinkingItems() {
        val current = _items.value
        if (current.none { it is ChatItem.Thinking && it.ephemeral }) return
        _items.value = current.filterNot { it is ChatItem.Thinking && it.ephemeral }
    }

    private fun addItem(item: ChatItem) {
        _items.value = _items.value + item
        persistHistory()
    }

    private fun persistHistory() {
        val sid = _viewSessionId.value ?: return
        history.saveEntries(sid, _items.value.filterIsInstance<ChatItem.Text>().map { it.toHistoryEntry() })
    }

    fun canUndoUserMessage(msg: ChatItem.Text, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (msg.role != "user") return false
        if (msg.failed) return false
        val elapsed = (nowMs - msg.ts).coerceAtLeast(0L)
        return elapsed <= userUndoWindowMs
    }

    fun canEditUserMessage(msg: ChatItem.Text, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (msg.role != "user") return false
        if (msg.failed) return false
        if (msg.delivery == DeliveryStatus.SENDING) return false
        if (msg.editedCount >= userEditMaxCount) return false
        val elapsed = (nowMs - msg.ts).coerceAtLeast(0L)
        return elapsed <= userEditWindowMs
    }

    fun undoUserMessage(messageId: String): Boolean {
        if (messageId.isBlank()) return false
        val current = _items.value.toMutableList()
        val idx = current.indexOfFirst { it is ChatItem.Text && it.id == messageId && it.role == "user" }
        if (idx < 0) return false
        val target = current[idx] as ChatItem.Text
        if (!canUndoUserMessage(target)) return false

        val pendingIds = pendingPrompts
            .filterValues { it.message.id == messageId }
            .keys
            .toList()
        pendingIds.forEach { clearPending(it) }
        current.removeAt(idx)
        _items.value = current
        persistHistory()
        return true
    }

    fun editUserMessage(messageId: String, newText: String): Boolean {
        if (messageId.isBlank()) return false
        val trimmed = newText.trim()
        if (trimmed.isBlank()) return false

        val current = _items.value.toMutableList()
        val idx = current.indexOfFirst { it is ChatItem.Text && it.id == messageId && it.role == "user" }
        if (idx < 0) return false
        val target = current[idx] as ChatItem.Text
        if (!canEditUserMessage(target)) return false
        if (target.content == trimmed) return false

        current[idx] = target.copy(
            content = trimmed,
            editedCount = target.editedCount + 1,
            editedAt = System.currentTimeMillis(),
            originalContent = target.originalContent ?: target.content,
        )
        _items.value = current
        persistHistory()
        return true
    }

    fun send(text: String) {
        if (!requireActiveSession(s(R.string.chat_vm_action_send))) return
        val trimmed = text.trim()
        if (trimmed.isBlank()) return
        val intentCommand = resolveNaturalLanguageIntent(trimmed)
        val outbound = intentCommand ?: trimmed
        if (intentCommand != null) {
            toastRes(R.string.chat_vm_toast_identified_command, intentCommand)
        }
        if (!canSendRealtime()) {
            queueDraft(outbound)
            return
        }
        val ok = sendNow(outbound)
        if (!ok) queueDraft(outbound)
    }

    private fun sendNow(text: String): Boolean {
        val key = keyStore.sharedKey ?: return false
        val deviceId = keyStore.deviceId ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val relayClient = relay ?: return false
        if (!relayClient.isConnected) return false

        val messageTaskId = resolveCurrentTextTaskIdForOutgoing(text)
        val msg = ChatItem.Text("user", text, delivery = DeliveryStatus.SENDING, taskId = messageTaskId)
        addItem(msg)
        updateCurrentTextTaskId(messageTaskId)

        if (text.startsWith("/")) {
            recordRecentCommand(text)
            if (handleLocalSlashCommand(text, msg)) {
                updateLastUserDelivery(DeliveryStatus.DELIVERED)
                return true
            }
            if (shellMode) {
                return sendSlashAsAgentCommand(text, msg, key, deviceId, sessionId, relayClient)
            }
        }

        // Shell 回退：agent offline 时走 shell_exec RPC
        if (shellMode) {
            val rpcId = java.util.UUID.randomUUID().toString().take(8)
            pendingShellRpc[rpcId] = msg
            val payload = JSONObject().put("id", rpcId)
                .put("method", "shell_exec")
                .put("params", JSONObject().put("command", text))
                .toString()
            return try {
                relayClient.send(
                    EnvelopeHelper.create(
                        source = deviceId,
                        target = "broadcast",
                        sessionId = sessionId,
                        type = "rpc_req",
                        plaintext = payload,
                        sharedKey = key
                    )
                )
                true
            } catch (_: Exception) {
                markFailed(msg)
                false
            }
        }

        return try {
            sendPromptEnvelope(text, msg, key, deviceId, sessionId, relayClient)
        } catch (_: Exception) {
            markFailed(msg)
            false
        }
    }

    private fun sendPromptEnvelope(
        text: String,
        msg: ChatItem.Text,
        key: ByteArray,
        deviceId: String,
        sessionId: String,
        relayClient: MessageTransport,
    ): Boolean {
        val envelope = EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "prompt",
            plaintext = text, sharedKey = key
        )
        val messageId = envelope.optString("id")
        if (messageId.isBlank()) {
            markFailed(msg)
            return false
        }
        val pending = PendingPrompt(messageId, envelope, msg)
        pendingPrompts[messageId] = pending
        sendPromptWithRetry(pending)
        return true
    }

    private fun parseSlashCommand(text: String): Pair<String, List<String>>? {
        val trimmed = text.trim()
        if (!trimmed.startsWith("/")) return null
        val parts = trimmed.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (parts.isEmpty()) return null
        val rawCommand = parts.first().removePrefix("/").lowercase()
        if (rawCommand.isBlank()) return null
        val aliases = mapOf(
            "settings" to "config",
            "bug" to "feedback",
            "quit" to "exit",
            "watcher" to "watch",
            "notify" to "watch",
            "notif" to "watch",
            "undoapproval" to "undo-approval",
            "undo_approval" to "undo-approval",
            "allowed_tools" to "permissions",
            "allowed-tools" to "permissions",
            "output_style" to "output-style",
            "add_dir" to "add-dir",
            "extra_usage" to "extra-usage",
            "install_github_app" to "install-github-app",
            "install_slack_app" to "install-slack-app",
            "pr_comments" to "pr-comments",
            "privacy_settings" to "privacy-settings",
            "release_notes" to "release-notes",
            "reload_plugins" to "reload-plugins",
            "remote_control" to "remote-control",
            "remote_env" to "remote-env",
            "security_review" to "security-review",
            "terminal_setup" to "terminal-setup",
            "continue_" to "continue",
            "reset" to "clear",
            "new" to "clear",
            "app" to "desktop",
            "ios" to "mobile",
            "android" to "mobile",
            "rc" to "remote-control",
        )
        val command = aliases[rawCommand] ?: rawCommand
        return command to parts.drop(1)
    }

    fun slashCommandSuggestions(input: String, limit: Int = 8): List<SlashCommandSuggestion> {
        val trimmed = input.trimStart()
        if (!trimmed.startsWith("/")) return emptyList()
        val raw = trimmed.removePrefix("/")
        val query = raw.substringBefore(' ').lowercase()
        val byPrefix = if (query.isBlank()) {
            slashCommandCatalog
        } else {
            slashCommandCatalog.filter {
                it.command.startsWith(query) || it.usage.lowercase().contains(query)
            }
        }
        if (query.isNotBlank()) return byPrefix.take(limit)

        val byCommand = slashCommandCatalog.associateBy { it.command }
        val recent = _recentCommands.value
            .mapNotNull { commandText ->
                val command = commandText.removePrefix("/").substringBefore(' ').lowercase()
                byCommand[command]?.copy(group = s(R.string.chat_slash_group_recent))
            }
            .distinctBy { it.command }
        val merged = buildList {
            addAll(recent)
            addAll(byPrefix.filter { suggestion -> recent.none { it.command == suggestion.command } })
        }
        return merged.take(limit)
    }

    private fun firstNumber(text: String): Int? {
        val m = Regex("""\d{1,3}""").find(text) ?: return null
        return m.value.toIntOrNull()
    }

    private fun resolveNaturalLanguageIntent(text: String): String? {
        if (text.startsWith("/")) return null
        val normalized = text.trim().lowercase()
        if (normalized.length < 2) return null
        if (normalized.contains("最近") && normalized.contains("任务")) {
            val n = (firstNumber(normalized) ?: 10).coerceIn(5, 30)
            return "/history $n"
        }
        if (normalized.contains("待审批") || normalized.contains("审批列表")) {
            val page = (firstNumber(normalized) ?: 1).coerceIn(1, 999)
            return if (page == 1) "/approvals" else "/approvals $page"
        }
        if ((normalized.contains("批准") || normalized.contains("通过")) &&
            (normalized.contains("全部") || normalized.contains("所有")) &&
            normalized.contains("审批")
        ) {
            return "/approvals bulk approve"
        }
        if ((normalized.contains("拒绝") || normalized.contains("驳回")) &&
            (normalized.contains("全部") || normalized.contains("所有")) &&
            normalized.contains("审批")
        ) {
            return "/approvals bulk reject"
        }
        if ((normalized.contains("查看任务") || normalized.contains("任务详情")) && text.contains("task_")) {
            val id = Regex("""task_[a-zA-Z0-9._:-]+""").find(text)?.value.orEmpty()
            if (id.isNotBlank()) return "/task $id"
        }
        if (normalized == "探活" || normalized.contains("探活")) return "/probe"
        if (normalized == "帮助" || normalized.contains("命令帮助")) return "/help"
        return null
    }

    private fun parsePositiveIntArg(
        raw: String?,
        fallback: Int,
        min: Int,
        max: Int,
    ): Int {
        val parsed = raw?.toIntOrNull() ?: return fallback
        return parsed.coerceIn(min, max)
    }

    private fun parseCliArgValue(args: List<String>, name: String): String? {
        val key = "--$name"
        val inline = args.firstOrNull { it.startsWith("$key=") }?.substringAfter("=")
        if (!inline.isNullOrBlank()) return inline
        val index = args.indexOfFirst { it == key }
        if (index >= 0 && index + 1 < args.size) {
            return args[index + 1]
        }
        return null
    }

    private fun paginateText(
        source: String,
        requestedPage: Int,
        pageChars: Int,
    ): Triple<Int, Int, String> {
        if (source.isBlank()) return Triple(1, 1, "")
        val effectivePageChars = pageChars.coerceIn(600, 3000)
        val totalPages = maxOf(1, (source.length + effectivePageChars - 1) / effectivePageChars)
        val page = requestedPage.coerceIn(1, totalPages)
        val start = (page - 1) * effectivePageChars
        val end = minOf(source.length, start + effectivePageChars)
        return Triple(page, totalPages, source.substring(start, end))
    }

    private fun renderWatchStatus(): String {
        val states = listOf(
            "approvals=${if (NotificationPrefs.approvalEnabled) "on" else "off"}",
            "errors=${if (NotificationPrefs.errorEnabled) "on" else "off"}",
            "agent=${if (NotificationPrefs.agentEnabled) "on" else "off"}",
            "tools=${if (NotificationPrefs.toolEnabled) "on" else "off"}",
        )
        return s(R.string.chat_vm_watch_status, states.joinToString(" · "))
    }

    private fun setWatchScope(scope: String, enabled: Boolean): Boolean {
        when (scope) {
            "all" -> {
                NotificationPrefs.approvalEnabled = enabled
                NotificationPrefs.errorEnabled = enabled
                NotificationPrefs.agentEnabled = enabled
                NotificationPrefs.toolEnabled = enabled
                return true
            }
            "approvals", "approval" -> NotificationPrefs.approvalEnabled = enabled
            "errors", "error" -> NotificationPrefs.errorEnabled = enabled
            "agent", "status" -> NotificationPrefs.agentEnabled = enabled
            "tools", "tool" -> NotificationPrefs.toolEnabled = enabled
            else -> return false
        }
        return true
    }

    private fun formatEpochMs(value: Long): String {
        if (value <= 0L) return "-"
        return runCatching {
            java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA)
                .format(java.util.Date(value))
        }.getOrDefault("-")
    }

    private fun clampChatText(value: String, maxChars: Int = 3200): String {
        if (value.length <= maxChars) return value
        return "${value.take(maxChars - 14)}\n...(truncated)"
    }

    private fun readTaskOutputText(result: JSONObject): String {
        val direct = result.optString("output", "").trim()
        if (direct.isNotBlank()) return direct
        val lines = result.optJSONArray("outputLines")
        if (lines == null || lines.length() == 0) return ""
        val out = StringBuilder()
        for (i in 0 until lines.length()) {
            val line = lines.optString(i)
            if (line.isBlank()) continue
            if (out.isNotEmpty()) out.append('\n')
            out.append(line)
        }
        return out.toString().trim()
    }

    private fun resolveApprovalPage(
        requestedPage: Int,
        pageSize: Int = 6,
    ): Triple<Int, Int, List<ChatItem.Approval>> {
        val all = pendingApprovals.values.toList().asReversed()
        val total = all.size
        val totalPages = maxOf(1, (total + pageSize - 1) / pageSize)
        val page = requestedPage.coerceIn(1, totalPages)
        val start = (page - 1) * pageSize
        val items = if (total == 0) emptyList() else all.drop(start).take(pageSize)
        return Triple(page, totalPages, items)
    }

    private fun buildApprovalListText(
        requestedPage: Int,
        banner: String? = null,
        pageSize: Int = 6,
    ): String {
        val all = pendingApprovals.values.toList().asReversed()
        val (page, totalPages, pageItems) = resolveApprovalPage(requestedPage, pageSize)
        val lines = mutableListOf<String>()
        if (!banner.isNullOrBlank()) lines.add(banner)
        lines.add(s(R.string.chat_vm_approval_list_header, page, totalPages, all.size))
        if (pageItems.isEmpty()) {
            lines.add(s(R.string.chat_vm_approval_none))
        } else {
            val start = (page - 1) * pageSize
            pageItems.forEachIndexed { index, item ->
                val number = start + index + 1
                lines.add("$number. ${item.id}")
                lines.add("   tool=${item.tool} risk=${item.riskLevel}")
                lines.add("   /approve ${item.id}")
                lines.add("   /reject ${item.id}")
            }
        }
        lines.add(s(R.string.chat_vm_usage_approvals))
        lines.add(s(R.string.chat_vm_undo_approvals_hint))
        return lines.joinToString("\n")
    }

    private fun handleLocalSlashCommand(text: String, msg: ChatItem.Text): Boolean {
        val parsed = parseSlashCommand(text) ?: return false
        val command = parsed.first
        val args = parsed.second
        fun addSystem(content: String, taskId: String? = null) {
            addItem(
                ChatItem.Text(
                    "ai",
                    content,
                    taskId = normalizeChatTextTaskId(taskId),
                    agent = "system",
                )
            )
        }
        when (command) {
            "help" -> {
                addSystem(
                    listOf(
                        s(R.string.chat_vm_help_title),
                        "/status /context /compact /rewind /memory /agents /style /permissions /statusline",
                        "/cwd /probe /tasks /history /task /approvals /approve /reject /undo-approval",
                        "/z2e <text> /e2z <text>",
                        "/watch <all|approvals|errors|agent|tools> <on|off>",
                        "/checkpoint /mode /plan /act",
                        s(R.string.chat_vm_help_footer),
                    ).joinToString("\n")
                )
                return true
            }
            "status", "probe" -> {
                probeForeground("slash_$command")
                refreshSessionControl()
                return true
            }
            "context" -> {
                val ok = sendRpcRequest("context_usage", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_context_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val result = obj.optJSONObject("result") ?: JSONObject()
                    addSystem(
                        listOf(
                            "Context Usage",
                            "used: ${result.optInt("usedPercentage", 0)}%",
                            "tokens: ${result.optInt("estimatedUsedTokens", 0)} / ${result.optInt("contextWindowSize", 0)}",
                            "running: ${result.optInt("runningTasks", 0)} · queue: ${result.optInt("queuedTasks", 0)}",
                        ).joinToString("\n")
                    )
                    refreshSessionControl()
                }
                if (!ok) toastRes(R.string.chat_vm_toast_context_failed_disconnected)
                return ok
            }
            "compact" -> {
                compactContext(args.joinToString(" "))
                return true
            }
            "mode" -> {
                val target = args.firstOrNull()?.lowercase()
                if (target == null || (target != "plan" && target != "act")) {
                    addSystem(s(R.string.chat_vm_usage_mode))
                    return true
                }
                val ok = sendRpcRequest("set_execution_mode", mapOf("mode" to target)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_mode_switch_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val message = obj.optJSONObject("result")?.optString("message").orEmpty()
                    addSystem(if (message.isNotBlank()) message else "mode switched to $target")
                }
                if (!ok) toastRes(R.string.chat_vm_toast_mode_switch_failed_disconnected)
                return ok
            }
            "plan", "act" -> {
                val ok = sendRpcRequest("set_execution_mode", mapOf("mode" to command)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_mode_switch_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    addSystem(obj.optJSONObject("result")?.optString("message").orEmpty())
                }
                if (!ok) toastRes(R.string.chat_vm_toast_mode_switch_failed_disconnected)
                return ok
            }
            "cwd" -> {
                if (args.isEmpty()) {
                    addSystem(s(R.string.chat_vm_current_working_dir, _agentState.value.projectPath ?: "(unknown)"))
                    return true
                }
                val ok = sendRpcRequest("change_cwd", mapOf("path" to args.joinToString(" "))) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_cwd_switch_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val result = obj.optJSONObject("result") ?: JSONObject()
                    addSystem(s(R.string.chat_vm_cwd_switched_to, result.optString("cwd", "(unknown)")))
                    refreshSessionControl()
                }
                if (!ok) toastRes(R.string.chat_vm_toast_cwd_switch_failed_disconnected)
                return ok
            }
            "tasks" -> {
                val ok = sendRpcRequest("list_tasks", mapOf("limit" to 30)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_tasks_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val items = obj.optJSONObject("result")?.optJSONArray("items")
                    if (items == null || items.length() == 0) {
                        addSystem(s(R.string.chat_vm_tasks_none))
                        return@sendRpcRequest
                    }
                    val lines = mutableListOf("Tasks")
                    for (i in 0 until minOf(12, items.length())) {
                        val item = items.optJSONObject(i) ?: continue
                        lines.add("- ${item.optString("taskId")} · ${item.optString("status")} · ${item.optString("agent")}")
                    }
                    addSystem(lines.joinToString("\n"))
                }
                if (!ok) toastRes(R.string.chat_vm_toast_tasks_failed_disconnected)
                return ok
            }
            "history" -> {
                val limit = parsePositiveIntArg(args.firstOrNull(), fallback = 12, min = 5, max = 30)
                val ok = sendRpcRequest("list_tasks", mapOf("limit" to limit)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_history_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val items = obj.optJSONObject("result")?.optJSONArray("items")
                    if (items == null || items.length() == 0) {
                        addSystem(s(R.string.chat_vm_task_history_none))
                        return@sendRpcRequest
                    }
                    val lines = mutableListOf(
                        s(R.string.chat_vm_task_history_header, minOf(limit, items.length())),
                        s(R.string.chat_vm_task_history_hint)
                    )
                    for (i in 0 until minOf(limit, items.length())) {
                        val item = items.optJSONObject(i) ?: continue
                        val taskId = item.optString("taskId", "unknown")
                        val status = item.optString("status", "unknown")
                        val agent = item.optString("agent", "unknown")
                        val source = item.optString("source", "unknown")
                        val startedAt = formatEpochMs(item.optLong("startedAt", 0L))
                        val endedAt = formatEpochMs(item.optLong("endedAt", 0L))
                        val preview = item.optString("promptPreview", "").trim()
                        val timeLine = if (endedAt != "-") "$startedAt → $endedAt" else startedAt
                        lines.add("- $taskId · $status · $agent · $source")
                        lines.add("  $timeLine")
                        if (preview.isNotBlank()) lines.add("  $preview")
                        lines.add("  /task $taskId")
                    }
                    addSystem(lines.joinToString("\n"))
                }
                if (!ok) toastRes(R.string.chat_vm_toast_history_failed_disconnected)
                return ok
            }
            "task" -> {
                val taskId = args.firstOrNull().orEmpty().trim()
                if (taskId.isBlank()) {
                    addSystem(s(R.string.chat_vm_usage_task))
                    return true
                }
                updateCurrentTextTaskId(taskId)
                val optionArgs = args.drop(1)
                val page = parsePositiveIntArg(
                    raw = optionArgs.firstOrNull { it.all(Char::isDigit) }
                        ?: parseCliArgValue(optionArgs, "page"),
                    fallback = 1,
                    min = 1,
                    max = 999,
                )
                val pageSize = parsePositiveIntArg(
                    raw = parseCliArgValue(optionArgs, "size"),
                    fallback = 1400,
                    min = 600,
                    max = 3000,
                )
                val ok = sendRpcRequest("task_output", mapOf("taskId" to taskId)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_task_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val result = obj.optJSONObject("result") ?: JSONObject()
                    val status = result.optString("status", "unknown")
                    val promptId = result.optString("promptId", "").trim()
                    val output = readTaskOutputText(result)
                    val lines = mutableListOf(
                        s(R.string.chat_vm_task_detail_title, taskId),
                        "status: $status",
                    )
                    if (promptId.isNotBlank()) lines.add("promptId: $promptId")
                    lines.add("")
                    if (output.isBlank()) {
                        lines.add("(no output)")
                    } else {
                        val (currentPage, totalPages, pageText) = paginateText(output, page, pageSize)
                        lines.add("output page: $currentPage/$totalPages（chars=${output.length}）")
                        lines.add(clampChatText(pageText, maxChars = pageSize + 64))
                        if (totalPages > 1) {
                            val prevPage = (currentPage - 1).coerceAtLeast(1)
                            val nextPage = (currentPage + 1).coerceAtMost(totalPages)
                            lines.add("")
                            lines.add(s(R.string.chat_vm_task_pagination_hint, taskId, prevPage, nextPage))
                        }
                    }
                    addSystem(lines.joinToString("\n"), taskId = taskId)
                }
                if (!ok) toastRes(R.string.chat_vm_toast_task_failed_disconnected)
                return ok
            }
            "approvals" -> {
                val first = args.firstOrNull()?.lowercase()
                val pageSize = parsePositiveIntArg(
                    raw = args.firstOrNull { it.startsWith("--size=") }?.substringAfter("="),
                    fallback = 6,
                    min = 3,
                    max = 12,
                )
                if (first == "bulk") {
                    val mode = args.getOrNull(1)?.lowercase()
                    val approved = mode == "approve" || mode == "approved" || mode == "y" || mode == "yes"
                    val rejected = mode == "reject" || mode == "rejected" || mode == "n" || mode == "no"
                    if (!approved && !rejected) {
                        addSystem(s(R.string.chat_vm_usage_approvals_bulk))
                        return true
                    }
                    val requestedPage = parsePositiveIntArg(args.getOrNull(2), fallback = 1, min = 1, max = 999)
                    val (page, _, pageItems) = resolveApprovalPage(requestedPage, pageSize)
                    if (pageItems.isEmpty()) {
                        addSystem(buildApprovalListText(page, banner = s(R.string.chat_vm_approval_none_on_page), pageSize = pageSize))
                        return true
                    }
                    val ids = pageItems.map { it.id }
                    ids.forEach { approvalId -> respondApproval(approvalId, approved = approved) }
                    val banner = if (approved) {
                        s(R.string.chat_vm_queued_bulk_approve, ids.size)
                    } else {
                        s(R.string.chat_vm_queued_bulk_reject, ids.size)
                    }
                    addSystem(buildApprovalListText(page, banner = banner, pageSize = pageSize))
                    return true
                }

                val requestedPage = when {
                    first == null -> 1
                    first == "page" -> parsePositiveIntArg(args.getOrNull(1), fallback = 1, min = 1, max = 999)
                    first.all { it.isDigit() } -> parsePositiveIntArg(first, fallback = 1, min = 1, max = 999)
                    else -> 1
                }
                addSystem(buildApprovalListText(requestedPage, pageSize = pageSize))
                return true
            }
            "approve", "reject" -> {
                val approved = command == "approve"
                val requestedId = args.firstOrNull()?.trim().orEmpty()
                val approvalId = if (requestedId.isNotBlank()) {
                    if (pendingApprovals.containsKey(requestedId)) requestedId else ""
                } else {
                    pendingApprovals.values.lastOrNull()?.id.orEmpty()
                }
                if (approvalId.isBlank()) {
                    addSystem(
                        if (requestedId.isNotBlank()) {
                            s(R.string.chat_vm_approval_id_not_found, requestedId)
                        } else {
                            s(R.string.chat_vm_approval_none)
                        }
                    )
                    return true
                }
                respondApproval(approvalId, approved = approved)
                addSystem(
                    if (approved) {
                        s(R.string.chat_vm_approval_queued_approve, approvalId)
                    } else {
                        s(R.string.chat_vm_approval_queued_reject, approvalId)
                    }
                )
                return true
            }
            "undo-approval" -> {
                val approvalId = args.firstOrNull()?.trim().orEmpty()
                val ok = undoApprovalResponse(approvalId.ifBlank { null })
                if (!ok) {
                    addSystem(s(R.string.chat_vm_approval_undo_none))
                } else {
                    addSystem(
                        if (approvalId.isBlank()) {
                            s(R.string.chat_vm_approval_undo_latest)
                        } else {
                            s(R.string.chat_vm_approval_undo_id, approvalId)
                        }
                    )
                }
                return true
            }
            "watch" -> {
                if (args.isEmpty()) {
                    addSystem(
                        listOf(
                            renderWatchStatus(),
                            s(R.string.chat_vm_usage_watch),
                            s(R.string.chat_vm_usage_watch_example),
                        ).joinToString("\n")
                    )
                    return true
                }
                val scope = args.first().lowercase()
                val modeRaw = args.getOrNull(1)?.lowercase()
                val enabled: Boolean? = when (modeRaw ?: scope) {
                    "on", "enable", "enabled" -> true
                    "off", "disable", "disabled" -> false
                    else -> if (modeRaw == null) true else null
                }
                val actualScope = when (scope) {
                    "on", "off", "enable", "disable", "enabled", "disabled" -> "all"
                    else -> scope
                }
                if (enabled == null || !setWatchScope(actualScope, enabled)) {
                    addSystem(s(R.string.chat_vm_usage_watch))
                    return true
                }
                addSystem(renderWatchStatus())
                return true
            }
            "checkpoint" -> {
                val action = args.firstOrNull()?.lowercase() ?: "list"
                if (action == "list") {
                    val ok = sendRpcRequest("list_checkpoints", mapOf("limit" to 10)) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_checkpoint_query_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        val arr = obj.optJSONObject("result")?.optJSONArray("items")
                        if (arr == null || arr.length() == 0) {
                            addSystem(s(R.string.chat_vm_checkpoint_none))
                            return@sendRpcRequest
                        }
                        val lines = mutableListOf("Checkpoint")
                        for (i in 0 until minOf(10, arr.length())) {
                            val item = arr.optJSONObject(i) ?: continue
                            lines.add("- ${item.optString("id")} · files=${item.optJSONArray("files")?.length() ?: 0}")
                        }
                        addSystem(lines.joinToString("\n"))
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_checkpoint_query_failed_disconnected)
                    return ok
                }
                if (action == "restore") {
                    val id = args.getOrNull(1).orEmpty()
                    if (id.isBlank()) {
                        addSystem(s(R.string.chat_vm_usage_checkpoint_restore))
                        return true
                    }
                    val ok = sendRpcRequest("restore_checkpoint", mapOf("id" to id)) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_checkpoint_restore_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        addSystem(obj.optJSONObject("result")?.optString("message").orEmpty())
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_checkpoint_restore_failed_disconnected)
                    return ok
                }
                addSystem(s(R.string.chat_vm_usage_checkpoint))
                return true
            }
            "rewind" -> {
                val target = args.firstOrNull().orEmpty()
                if (target.isBlank()) {
                    addSystem(s(R.string.chat_vm_usage_rewind))
                    return true
                }
                val dryRun = args.any { it == "--dry-run" || it == "dry-run" }
                val method = if (dryRun) "rewind_preview" else "rewind_to_message"
                val ok = sendRpcRequest(method, mapOf("target" to target, "dryRun" to dryRun)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_rewind_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    addSystem(obj.optJSONObject("result")?.toString(2) ?: "rewind done")
                }
                if (!ok) toastRes(R.string.chat_vm_toast_rewind_failed_disconnected)
                return ok
            }
            "memory" -> {
                val action = args.firstOrNull()?.lowercase() ?: "status"
                when (action) {
                    "status", "show" -> {
                        val ok = sendRpcRequest("memory_status", emptyMap()) { obj ->
                            val err = rpcError(obj)
                            if (err != null) {
                                toastRes(R.string.chat_vm_toast_memory_query_failed_with_error, err)
                                return@sendRpcRequest
                            }
                            addSystem(obj.optJSONObject("result")?.toString(2) ?: "{}")
                            refreshSessionControl()
                        }
                        if (!ok) toastRes(R.string.chat_vm_toast_memory_query_failed_disconnected)
                        return ok
                    }
                    "on", "off" -> {
                        val ok = sendRpcRequest("memory_toggle", mapOf("enabled" to (action == "on"))) { obj ->
                            val err = rpcError(obj)
                            if (err != null) {
                                toastRes(R.string.chat_vm_toast_memory_toggle_failed_with_error, err)
                                return@sendRpcRequest
                            }
                            addSystem("memory: ${if (obj.optJSONObject("result")?.optBoolean("enabled", false) == true) "ON" else "OFF"}")
                            refreshSessionControl()
                        }
                        if (!ok) toastRes(R.string.chat_vm_toast_memory_toggle_failed_disconnected)
                        return ok
                    }
                    "add" -> {
                        val note = args.drop(1).joinToString(" ").trim()
                        if (note.isBlank()) {
                            addSystem(s(R.string.chat_vm_usage_memory_add))
                            return true
                        }
                        val ok = sendRpcRequest("memory_add_note", mapOf("note" to note)) { obj ->
                            val err = rpcError(obj)
                            if (err != null) {
                                toastRes(R.string.chat_vm_toast_memory_append_failed_with_error, err)
                                return@sendRpcRequest
                            }
                            addSystem(
                                s(
                                    R.string.chat_vm_memory_appended_file,
                                    obj.optJSONObject("result")?.optString("file") ?: s(R.string.common_unknown),
                                )
                            )
                        }
                        if (!ok) toastRes(R.string.chat_vm_toast_memory_append_failed_disconnected)
                        return ok
                    }
                    else -> {
                        addSystem(s(R.string.chat_vm_usage_memory))
                        return true
                    }
                }
            }
            "agents" -> {
                val action = args.firstOrNull()?.lowercase() ?: "list"
                if (action == "delete" || action == "rm") {
                    val name = args.getOrNull(1).orEmpty()
                    if (name.isBlank()) {
                        addSystem(s(R.string.chat_vm_usage_agents_delete))
                        return true
                    }
                    val ok = sendRpcRequest("delete_agent", mapOf("name" to name)) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_agent_delete_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        addSystem("agent $name: ${if (obj.optJSONObject("result")?.optBoolean("deleted", false) == true) "deleted" else "not found"}")
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_agent_delete_failed_disconnected)
                    return ok
                }
                val ok = sendRpcRequest("list_agents", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_agents_query_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val arr = obj.optJSONObject("result")?.optJSONArray("items")
                    if (arr == null || arr.length() == 0) {
                        addSystem(s(R.string.chat_vm_agents_none))
                        return@sendRpcRequest
                    }
                    val lines = mutableListOf("Agents")
                    for (i in 0 until minOf(20, arr.length())) {
                        val item = arr.optJSONObject(i) ?: continue
                        lines.add("- ${item.optString("name")}: ${item.optString("description")}")
                    }
                    addSystem(lines.joinToString("\n"))
                }
                if (!ok) toastRes(R.string.chat_vm_toast_agents_query_failed_disconnected)
                return ok
            }
            "style", "output-style" -> {
                val action = args.firstOrNull()?.lowercase() ?: "show"
                if (action == "list") {
                    val ok = sendRpcRequest("list_output_styles", emptyMap()) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_style_query_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        val arr = obj.optJSONObject("result")?.optJSONArray("items")
                        if (arr == null || arr.length() == 0) {
                            addSystem(s(R.string.chat_vm_output_style_none))
                            return@sendRpcRequest
                        }
                        val lines = mutableListOf("Output Styles")
                        for (i in 0 until minOf(20, arr.length())) {
                            val item = arr.optJSONObject(i) ?: continue
                            lines.add("- ${item.optString("id")} (${item.optString("source")})")
                        }
                        addSystem(lines.joinToString("\n"))
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_style_query_failed_disconnected)
                    return ok
                }
                if (action == "set") {
                    val id = args.getOrNull(1).orEmpty()
                    if (id.isBlank()) {
                        addSystem(s(R.string.chat_vm_usage_style_set))
                        return true
                    }
                    val ok = sendRpcRequest("set_output_style", mapOf("styleId" to id)) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_style_switch_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        addSystem(
                            s(
                                R.string.chat_vm_style_switched,
                                obj.optJSONObject("result")?.optString("styleId", id) ?: s(R.string.common_unknown),
                            )
                        )
                        refreshSessionControl()
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_style_switch_failed_disconnected)
                    return ok
                }
                val ok = sendRpcRequest("get_output_style", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_style_query_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val result = obj.optJSONObject("result") ?: JSONObject()
                    addSystem(s(R.string.chat_vm_current_style, result.optString("id"), result.optString("description")))
                    refreshSessionControl()
                }
                if (!ok) toastRes(R.string.chat_vm_toast_style_query_failed_disconnected)
                return ok
            }
            "permissions" -> {
                val ok = sendRpcRequest("get_permissions", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_permissions_query_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    addSystem(obj.optJSONObject("result")?.toString(2) ?: "{}")
                }
                if (!ok) toastRes(R.string.chat_vm_toast_permissions_query_failed_disconnected)
                return ok
            }
            "statusline" -> {
                val action = args.firstOrNull()?.lowercase() ?: "show"
                if (action == "on" || action == "off") {
                    val ok = sendRpcRequest("set_statusline", mapOf("enabled" to (action == "on"))) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_statusline_set_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        addSystem("statusline: ${if (obj.optJSONObject("result")?.optBoolean("enabled", false) == true) "ON" else "OFF"}")
                        refreshSessionControl()
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_statusline_set_failed_disconnected)
                    return ok
                }
                if (action == "set") {
                    val commandText = args.drop(1).joinToString(" ").trim()
                    if (commandText.isBlank()) {
                        addSystem(s(R.string.chat_vm_usage_statusline_set))
                        return true
                    }
                    val ok = sendRpcRequest("set_statusline", mapOf("enabled" to true, "command" to commandText)) { obj ->
                        val err = rpcError(obj)
                        if (err != null) {
                            toastRes(R.string.chat_vm_toast_statusline_set_failed_with_error, err)
                            return@sendRpcRequest
                        }
                        addSystem(s(R.string.chat_vm_statusline_updated))
                        refreshSessionControl()
                    }
                    if (!ok) toastRes(R.string.chat_vm_toast_statusline_set_failed_disconnected)
                    return ok
                }
                val ok = sendRpcRequest("get_statusline", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_statusline_query_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val text = obj.optJSONObject("result")?.optString("text", "").orEmpty()
                    addSystem(if (text.isBlank()) "(empty)" else text)
                    refreshSessionControl()
                }
                if (!ok) toastRes(R.string.chat_vm_toast_statusline_query_failed_disconnected)
                return ok
            }
            "skill" -> {
                val name = args.firstOrNull().orEmpty()
                if (name.isBlank()) {
                    addSystem(s(R.string.chat_vm_usage_skill))
                    return true
                }
                val skillArgs = args.drop(1).joinToString(" ")
                val ok = sendRpcRequest("invoke_skill", mapOf("name" to name, "args" to skillArgs)) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_skill_invoke_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    addSystem(obj.optJSONObject("result")?.toString(2) ?: "skill invoked")
                }
                if (!ok) toastRes(R.string.chat_vm_toast_skill_invoke_failed_disconnected)
                return ok
            }
            "skills" -> {
                val ok = sendRpcRequest("list_skills", emptyMap()) { obj ->
                    val err = rpcError(obj)
                    if (err != null) {
                        toastRes(R.string.chat_vm_toast_skills_query_failed_with_error, err)
                        return@sendRpcRequest
                    }
                    val arr = obj.optJSONObject("result")?.optJSONArray("items")
                    if (arr == null || arr.length() == 0) {
                        addSystem(s(R.string.chat_vm_skills_none))
                        return@sendRpcRequest
                    }
                    val lines = mutableListOf("Skills")
                    for (i in 0 until minOf(24, arr.length())) {
                        val item = arr.optJSONObject(i) ?: continue
                        lines.add("- /${item.optString("name", item.optString("id"))}: ${item.optString("description")}")
                    }
                    addSystem(lines.joinToString("\n"))
                }
                if (!ok) toastRes(R.string.chat_vm_toast_skills_query_failed_disconnected)
                return ok
            }
        }
        return false
    }

    private fun sendSlashAsAgentCommand(
        text: String,
        msg: ChatItem.Text,
        key: ByteArray,
        deviceId: String,
        sessionId: String,
        relayClient: MessageTransport,
    ): Boolean {
        val rpcId = java.util.UUID.randomUUID().toString().take(8)
        pendingShellRpc[rpcId] = msg
        val payload = JSONObject().put("id", rpcId)
            .put("method", "agent_command")
            .put("params", JSONObject().put("command", text))
            .toString()
        return try {
            relayClient.send(
                EnvelopeHelper.create(
                    source = deviceId,
                    target = "broadcast",
                    sessionId = sessionId,
                    type = "rpc_req",
                    plaintext = payload,
                    sharedKey = key
                )
            )
            updateLastUserDelivery(DeliveryStatus.DELIVERED)
            true
        } catch (_: Exception) {
            markFailed(msg)
            false
        }
    }

    fun retry(msg: ChatItem.Text) {
        if (!requireActiveSession(s(R.string.chat_vm_action_retry))) return
        // 移除失败消息，重新发送
        _items.value = _items.value.filter { it !== msg }
        updateCurrentTextTaskId(msg.taskId)
        send(msg.content)
    }

    fun viewTask(taskId: String) {
        val id = taskId.trim()
        if (id.isBlank()) return
        updateCurrentTextTaskId(id)
        send("/task $id")
    }

    // ── Auto-Pilot 控制 ──

    fun startAutoPilot(prompt: String = "continue", maxIterations: Int = 10) {
        _autoPilot.value = AutoPilotState(
            enabled = true, iteration = 0,
            maxIterations = maxIterations, prompt = prompt
        )
        // 如果当前不在 streaming，立即发送第一条
        if (!_streaming.value && !_waiting.value) {
            autoPilotContinue()
        }
    }

    fun stopAutoPilot() {
        _autoPilot.value = _autoPilot.value.copy(enabled = false)
    }

    private fun autoPilotContinue() {
        val state = _autoPilot.value
        if (!state.enabled) return
        if (state.iteration >= state.maxIterations) {
            _autoPilot.value = state.copy(enabled = false)
            addItem(ChatItem.Text("system", s(R.string.chat_vm_autopilot_reached_max_rounds, state.maxIterations), taskId = currentTextTaskId))
            return
        }
        // 检测上一条 AI 回复是否包含完成标记
        val lastAi = _items.value.lastOrNull { it is ChatItem.Text && it.role == "ai" } as? ChatItem.Text
        if (lastAi != null && isAutoPilotComplete(lastAi.content)) {
            _autoPilot.value = state.copy(enabled = false)
            addItem(ChatItem.Text("system", s(R.string.chat_vm_autopilot_detected_done), taskId = currentTextTaskId))
            return
        }
        _autoPilot.value = state.copy(iteration = state.iteration + 1)
        send(state.prompt)
    }

    private fun isAutoPilotComplete(text: String): Boolean {
        val tail = text.takeLast(200).lowercase()
        return autoPilotCompletionMarkers.any { tail.contains(it.lowercase()) }
    }

    private fun markFailed(msg: ChatItem.Text) {
        val current = _items.value.toMutableList()
        val idx = current.indexOfFirst { it is ChatItem.Text && it.id == msg.id }
        if (idx >= 0) {
            val found = current[idx] as ChatItem.Text
            current[idx] = found.copy(failed = true)
            _items.value = current
        }
    }

    private fun updateUserDeliveryById(messageId: String, status: DeliveryStatus): Boolean {
        if (messageId.isBlank()) return false
        val current = _items.value.toMutableList()
        val idx = current.indexOfFirst { it is ChatItem.Text && it.role == "user" && it.id == messageId }
        if (idx >= 0) {
            val msg = current[idx] as ChatItem.Text
            if (msg.delivery != null && msg.delivery.ordinal < status.ordinal) {
                current[idx] = msg.copy(delivery = status)
                _items.value = current
                return true
            }
        }
        return false
    }

    private fun updateLastUserDelivery(status: DeliveryStatus) {
        val current = _items.value.toMutableList()
        val idx = current.indexOfLast { it is ChatItem.Text && it.role == "user" }
        if (idx >= 0) {
            val msg = current[idx] as ChatItem.Text
            if (msg.delivery != null && msg.delivery.ordinal < status.ordinal) {
                current[idx] = msg.copy(delivery = status)
                _items.value = current
            }
        }
    }

    private fun sendPromptWithRetry(pending: PendingPrompt, fromRetry: Boolean = false) {
        val relayClient = relay
        if (relayClient == null) {
            failPending(pending.messageId, s(R.string.chat_vm_send_failed_connection_not_ready))
            return
        }
        try {
            relayClient.send(pending.envelope)
            sendTimestamp = System.currentTimeMillis()
            _waiting.value = true
            val label = if (fromRetry) "retry" else "send"
            Log.d("Yuanio", "[chat] $label prompt ${pending.messageId}")
            scheduleAckTimeout(pending)
        } catch (_: Exception) {
            failPending(pending.messageId, s(R.string.chat_vm_send_failed_network_error))
        }
    }

    private fun scheduleAckTimeout(pending: PendingPrompt) {
        pending.timeout?.let { ackHandler.removeCallbacks(it) }
        val maxRetries = ackMaxRetries()
        val timeoutMs = ackTimeoutMsForRetry(pending.retries)
        val runnable = Runnable {
            val current = pendingPrompts[pending.messageId] ?: return@Runnable
            if (current.retries >= maxRetries) {
                failPending(current.messageId, s(R.string.chat_vm_send_failed_no_ack))
                return@Runnable
            }
            current.retries += 1
            Log.d("Yuanio", "[chat] ACK 超时，重试 ${current.retries}/$maxRetries (timeout=${timeoutMs}ms)")
            sendPromptWithRetry(current, fromRetry = true)
        }
        pending.timeout = runnable
        ackHandler.postDelayed(runnable, timeoutMs)
    }

    private fun handleAck(ack: RelayAck) {
        when (ack.state) {
            RelayAckState.RETRY_AFTER -> scheduleRetryAfter(ack)
            RelayAckState.TERMINAL -> {
                val reason = ack.reason?.takeIf { it.isNotBlank() } ?: s(R.string.chat_vm_send_failed_terminal)
                failPending(ack.messageId, reason)
            }
            RelayAckState.WORKING, RelayAckState.OK -> {
                pendingPrompts[ack.messageId]?.let { pending ->
                    updateUserDeliveryById(pending.message.id, DeliveryStatus.DELIVERED)
                }
                clearPending(ack.messageId)
            }
        }
    }

    private fun scheduleRetryAfter(ack: RelayAck) {
        val pending = pendingPrompts[ack.messageId] ?: return
        pending.timeout?.let { ackHandler.removeCallbacks(it) }
        val maxRetries = ackMaxRetries()
        val retryDelayMs = (ack.retryAfterMs ?: ackTimeoutMsForRetry(pending.retries))
            .coerceIn(300L, 30_000L)
        val runnable = Runnable {
            val current = pendingPrompts[ack.messageId] ?: return@Runnable
            if (current.retries >= maxRetries) {
                failPending(current.messageId, s(R.string.chat_vm_send_failed_peer_busy))
                return@Runnable
            }
            current.retries += 1
            Log.d("Yuanio", "[chat] ACK retry_after，延迟重试 ${current.retries}/$maxRetries (delay=${retryDelayMs}ms)")
            sendPromptWithRetry(current, fromRetry = true)
        }
        pending.timeout = runnable
        ackHandler.postDelayed(runnable, retryDelayMs)
    }

    private fun clearPending(messageId: String) {
        val pending = pendingPrompts.remove(messageId) ?: return
        pending.timeout?.let { ackHandler.removeCallbacks(it) }
    }

    private fun failPending(messageId: String, reason: String) {
        val pending = pendingPrompts.remove(messageId) ?: return
        pending.timeout?.let { ackHandler.removeCallbacks(it) }
        markFailed(pending.message)
        toastText = reason
        _waiting.value = false
    }

    fun approveAllSafe() {
        val safeIds = pendingApprovals.values
            .filter { isSafeApprovalRisk(it.riskLevel) }
            .map { it.id }
        if (safeIds.isEmpty()) {
            toastRes(R.string.chat_vm_toast_no_low_risk_approvals)
            return
        }
        safeIds.forEach { respondApproval(it, approved = true) }
        toastRes(R.string.chat_vm_toast_queued_low_risk_approvals, safeIds.size)
    }

    fun approveAllPending() {
        val ids = pendingApprovals.keys.toList()
        if (ids.isEmpty()) {
            toastRes(R.string.chat_vm_toast_no_pending_approvals)
            return
        }
        ids.forEach { respondApproval(it, approved = true) }
        toastRes(R.string.chat_vm_toast_queued_approve_approvals, ids.size)
    }

    fun rejectAllPending() {
        val ids = pendingApprovals.keys.toList()
        if (ids.isEmpty()) {
            toastRes(R.string.chat_vm_toast_no_pending_approvals)
            return
        }
        ids.forEach { respondApproval(it, approved = false) }
        toastRes(R.string.chat_vm_toast_queued_reject_approvals, ids.size)
    }

    private fun sendInteractionActionEnvelope(
        action: String,
        approvalId: String? = null,
        taskId: String? = null,
        path: String? = null,
        prompt: String? = null,
        reason: String? = null,
        source: String = "app",
    ): Boolean {
        val key = keyStore.sharedKey ?: return false
        val deviceId = keyStore.deviceId ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val activeRelay = relay ?: return false
        if (!activeRelay.isConnected) return false

        val payload = JSONObject().put("action", action).put("source", source)
        approvalId?.takeIf { it.isNotBlank() }?.let { payload.put("approvalId", it) }
        taskId?.takeIf { it.isNotBlank() }?.let { payload.put("taskId", it) }
        path?.takeIf { it.isNotBlank() }?.let { payload.put("path", it) }
        prompt?.takeIf { it.isNotBlank() }?.let { payload.put("prompt", it) }
        reason?.takeIf { it.isNotBlank() }?.let { payload.put("reason", it) }

        return runCatching {
            activeRelay.send(
                EnvelopeHelper.create(
                    source = deviceId,
                    target = "broadcast",
                    sessionId = sessionId,
                    type = "interaction_action",
                    plaintext = payload.toString(),
                    sharedKey = key,
                )
            )
            true
        }.getOrElse { false }
    }

    fun performInteractionAction(
        action: String,
        approvalId: String? = null,
        taskId: String? = null,
        path: String? = null,
        prompt: String? = null,
        reason: String? = null,
        source: String = "app",
    ) {
        if (!requireActiveSession(s(R.string.chat_vm_action_perform_interaction))) return
        val normalized = action.trim().lowercase()
        val allowed = setOf("continue", "stop", "approve", "reject", "retry", "rollback")
        if (normalized !in allowed) {
            toastRes(R.string.chat_vm_toast_unsupported_interaction_action, action)
            return
        }

        val resolvedApprovalId = if (normalized == "approve" || normalized == "reject") {
            approvalId?.takeIf { it.isNotBlank() }
                ?: _turnState.value.activeApprovalId
                ?: pendingApprovals.values.lastOrNull()?.id
        } else null

        val resolvedPrompt = when {
            normalized == "continue" || normalized == "retry" -> prompt?.takeIf { it.isNotBlank() } ?: "continue"
            else -> null
        }

        val ok = sendInteractionActionEnvelope(
            action = normalized,
            approvalId = resolvedApprovalId,
            taskId = taskId,
            path = path,
            prompt = resolvedPrompt,
            reason = reason,
            source = source,
        )
        if (!ok) {
            toastRes(R.string.chat_vm_toast_interaction_send_failed_disconnected)
            return
        }

        when (normalized) {
            "approve", "reject" -> {
                val id = resolvedApprovalId
                if (!id.isNullOrBlank()) {
                    cancelAutoReject(id)
                    pendingApprovals.remove(id)
                    syncApprovalQueueState()
                    if (_urgentApproval.value?.id == id) _urgentApproval.value = null
                    Notifier.cancelApprovalNotification(getApplication(), id)
                }
                toastRes(
                    if (normalized == "approve") {
                        R.string.chat_vm_toast_sent_approve_action
                    } else {
                        R.string.chat_vm_toast_sent_reject_action
                    }
                )
            }
            "stop" -> {
                _streaming.value = false
                _waiting.value = false
                toastRes(R.string.chat_vm_toast_sent_stop_action)
            }
            "rollback" -> {
                toastRes(R.string.chat_vm_toast_sent_rollback_action)
            }
            "retry" -> {
                toastRes(R.string.chat_vm_toast_sent_retry_action)
            }
            else -> {
                toastRes(R.string.chat_vm_toast_sent_continue_action)
            }
        }
    }

    fun respondApproval(approvalId: String, approved: Boolean) {
        val approval = pendingApprovals[approvalId] ?: return
        cancelAutoReject(approvalId)
        pendingApprovals.remove(approvalId)
        syncApprovalQueueState()
        if (_urgentApproval.value?.id == approvalId) {
            _urgentApproval.value = null
        }

        pendingApprovalCommits.remove(approvalId)?.commitJob?.cancel()
        val queuedAtMs = System.currentTimeMillis()
        val pendingCommit = PendingApprovalCommit(
            approval = approval,
            approved = approved,
            queuedAtMs = queuedAtMs,
        )
        pendingCommit.commitJob = viewModelScope.launch {
            delay(approvalUndoWindowMs)
            commitApprovalResponse(approval.id)
        }
        pendingApprovalCommits[approvalId] = pendingCommit
        _approvalUndoState.value = ApprovalUndoState(
            approvalId = approvalId,
            approved = approved,
            expiresAtMs = queuedAtMs + approvalUndoWindowMs,
        )
    }

    fun undoApprovalResponse(approvalId: String? = null): Boolean {
        val id = approvalId?.takeIf { it.isNotBlank() }
            ?: _approvalUndoState.value?.approvalId
            ?: pendingApprovalCommits.keys.lastOrNull()
            ?: return false
        val pendingCommit = pendingApprovalCommits.remove(id) ?: return false
        pendingCommit.commitJob?.cancel()
        pendingApprovals[id] = pendingCommit.approval
        syncApprovalQueueState()
        scheduleAutoRejectIfNeeded(pendingCommit.approval)
        if (_urgentApproval.value == null) {
            _urgentApproval.value = pendingCommit.approval
        }
        if (_approvalUndoState.value?.approvalId == id) {
            _approvalUndoState.value = null
        }
        toastRes(R.string.chat_vm_toast_undo_approval_action, id)
        return true
    }

    private fun commitApprovalResponse(approvalId: String) {
        val pendingCommit = pendingApprovalCommits.remove(approvalId) ?: return
        pendingCommit.commitJob?.cancel()

        val key = keyStore.sharedKey
        val deviceId = keyStore.deviceId
        val sessionId = keyStore.sessionId
        val activeRelay = relay

        val sent = if (key != null && deviceId != null && sessionId != null && activeRelay?.isConnected == true) {
            runCatching {
                val payload = JSONObject()
                    .put("id", approvalId)
                    .put("approved", pendingCommit.approved)
                    .toString()
                activeRelay.send(
                    EnvelopeHelper.create(
                        source = deviceId,
                        target = "broadcast",
                        sessionId = sessionId,
                        type = "approval_resp",
                        plaintext = payload,
                        sharedKey = key
                    )
                )
            }.isSuccess
        } else {
            false
        }

        if (!sent) {
            PendingApprovalStore(getApplication()).append(approvalId, pendingCommit.approved)
            toastRes(R.string.chat_vm_toast_approval_response_stashed)
        } else {
            toastText = if (pendingCommit.approved) {
                s(R.string.chat_vm_toast_approval_submitted_approve, approvalId)
            } else {
                s(R.string.chat_vm_toast_approval_submitted_reject, approvalId)
            }
        }

        if (_approvalUndoState.value?.approvalId == approvalId) {
            _approvalUndoState.value = null
        }
    }

    /** 远程新建会话 */
    fun newSession(workDir: String? = null, agent: String? = null) {
        if (!requireActiveSession(s(R.string.chat_vm_action_new_session))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return

        val payload = JSONObject().apply {
            workDir?.let { put("workDir", it) }
            agent?.let { put("agent", it) }
        }.toString()
        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "new_session",
            plaintext = payload, sharedKey = key
        ))
        // 清空当前消息
        _items.value = emptyList()
        _streaming.value = false
        _waiting.value = false
        receivingStream = false
        streamBuffer = StringBuilder()
        streamCommitJob?.cancel()
        streamCommitJob = null
        resetStreamCoordinatorState()
        pendingPrompts.values.forEach { it.timeout?.let { r -> ackHandler.removeCallbacks(r) } }
        pendingPrompts.clear()
    }

    /** 恢复历史会话（借鉴 teleclaude /resume 模式） */
    fun resumeSession(resumeSessionId: String) {
        if (!requireActiveSession(s(R.string.chat_vm_action_resume_session))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return

        val payload = JSONObject()
            .put("resumeSessionId", resumeSessionId)
            .toString()
        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "new_session",
            plaintext = payload, sharedKey = key
        ))
        toastRes(R.string.chat_vm_toast_resuming_session)
    }

    /** 切换 Agent（不清空消息历史，保持对话连续性） */
    fun switchAgent(agent: String) {
        if (!requireActiveSession(s(R.string.chat_vm_action_switch_agent))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return

        // 构建上下文摘要：最近 5 条消息
        val recentTexts = _items.value
            .filterIsInstance<ChatItem.Text>()
            .takeLast(5)
            .joinToString("\n") { "${it.role}: ${it.content.take(200)}" }

        val payload = JSONObject().apply {
            put("agent", agent)
            if (recentTexts.isNotBlank()) put("context", recentTexts)
        }.toString()

        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "new_session",
            plaintext = payload, sharedKey = key
        ))

        // 本地更新 agent 状态（不清空消息）
        updateAgentState(_agentState.value.copy(agent = agent))
        toastRes(R.string.chat_vm_toast_switched_to_agent, agent.uppercase())
    }

    /** 中止当前任务 */
    fun cancel() {
        if (!requireActiveSession(s(R.string.chat_vm_action_cancel_task))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return

        // 手动取消时同步停止 Auto-Pilot
        if (_autoPilot.value.enabled) stopAutoPilot()

        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "cancel",
            plaintext = "", sharedKey = key
        ))
        _streaming.value = false
        _waiting.value = false
        receivingStream = false
        streamBuffer = StringBuilder()
        streamCommitJob?.cancel()
        streamCommitJob = null
        resetStreamCoordinatorState()
        pendingPrompts.values.forEach { it.timeout?.let { r -> ackHandler.removeCallbacks(r) } }
        pendingPrompts.clear()
        toastRes(R.string.chat_vm_toast_sent_cancel_command)
    }

    /** 处理文件变更（accept / rollback） */
    fun applyDiffAction(path: String, action: String) {
        if (!requireActiveSession(s(R.string.chat_vm_action_handle_diff))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return
        if (path.isBlank()) return
        if (action != "accept" && action != "rollback") return

        val payload = JSONObject()
            .put("action", action)
            .put("path", path)
            .toString()

        relay?.send(
            EnvelopeHelper.create(
                source = deviceId,
                target = "broadcast",
                sessionId = sessionId,
                type = "diff_action",
                plaintext = payload,
                sharedKey = key
            )
        )
        toastText = if (action == "rollback") {
            s(R.string.chat_vm_toast_sent_rollback_path, path)
        } else {
            s(R.string.chat_vm_toast_sent_accept_path, path)
        }
    }

    /** 从指定消息处 Fork 新对话 */
    fun forkAt(index: Int) {
        val sid = _viewSessionId.value ?: keyStore.sessionId ?: return
        val forked = _items.value.take(index + 1).filterIsInstance<ChatItem.Text>()
        val forkId = "${sid}_fork_${System.currentTimeMillis()}"
        history.saveEntries(forkId, forked.map { it.toHistoryEntry() })
        _items.value = _items.value.take(index + 1)
        toastRes(R.string.chat_vm_toast_forked_from_here)
        persistHistory()
    }

    /** RPC 调用 */
    private val _rpcResult = MutableStateFlow<JSONObject?>(null)
    val rpcResult = _rpcResult.asStateFlow()

    private fun sendRpcRequest(
        method: String,
        params: Map<String, Any> = emptyMap(),
        onResponse: ((JSONObject) -> Unit)? = null
    ): Boolean {
        val key = keyStore.sharedKey ?: return false
        val deviceId = keyStore.deviceId ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val activeRelay = relay ?: return false
        if (!activeRelay.isConnected) return false

        val rpcId = java.util.UUID.randomUUID().toString().take(8)
        val payload = JSONObject().put("id", rpcId)
            .put("method", method)
            .put("params", JSONObject(params))
            .toString()
        if (onResponse != null) {
            pendingRpcCallbacks[rpcId] = onResponse
        }
        return runCatching {
            activeRelay.send(EnvelopeHelper.create(
                source = deviceId, target = "broadcast",
                sessionId = sessionId, type = "rpc_req",
                plaintext = payload, sharedKey = key
            ))
            true
        }.getOrElse {
            pendingRpcCallbacks.remove(rpcId)
            false
        }
    }

    fun rpc(method: String, params: Map<String, Any> = emptyMap()) {
        if (!requireActiveSession(s(R.string.chat_vm_action_rpc))) return
        val ok = sendRpcRequest(method, params)
        if (!ok) toastRes(R.string.chat_vm_toast_rpc_failed_disconnected)
    }

    private fun rpcError(obj: JSONObject): String? {
        val error = obj.optString("error")
        return if (error.isNotBlank()) error else null
    }

    fun refreshSessionControl() {
        if (!requireActiveSession(s(R.string.chat_vm_action_refresh_session_control))) return

        sendRpcRequest("context_usage", emptyMap()) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_context_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            _sessionControl.value = _sessionControl.value.copy(
                contextUsedPercentage = result.optInt("usedPercentage", _sessionControl.value.contextUsedPercentage),
                contextTokens = result.optInt("estimatedUsedTokens", _sessionControl.value.contextTokens),
                contextWindowSize = result.optInt("contextWindowSize", _sessionControl.value.contextWindowSize),
                runningTasks = result.optInt("runningTasks", _sessionControl.value.runningTasks),
                queueTasks = result.optInt("queuedTasks", _sessionControl.value.queueTasks),
                lastUpdatedAt = System.currentTimeMillis(),
            )
        }

        sendRpcRequest("memory_status", emptyMap()) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_memory_query_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            _sessionControl.value = _sessionControl.value.copy(
                memoryEnabled = result.optBoolean("autoMemoryEnabled", _sessionControl.value.memoryEnabled),
                lastUpdatedAt = System.currentTimeMillis(),
            )
        }

        sendRpcRequest("get_output_style", emptyMap()) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_style_query_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            _sessionControl.value = _sessionControl.value.copy(
                outputStyleId = result.optString("id", _sessionControl.value.outputStyleId),
                lastUpdatedAt = System.currentTimeMillis(),
            )
        }

        sendRpcRequest("get_statusline", emptyMap()) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_statusline_query_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            val text = result.optString("text", "").trim()
            _sessionControl.value = _sessionControl.value.copy(
                statusline = text,
                lastUpdatedAt = System.currentTimeMillis(),
            )
        }
    }

    fun compactContext(instructions: String = "") {
        if (!requireActiveSession(s(R.string.chat_vm_action_compact_context))) return
        val ok = sendRpcRequest("compact_context", mapOf("instructions" to instructions)) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_compact_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            _sessionControl.value = _sessionControl.value.copy(
                lastCompactPromptId = result.optString("promptId").takeIf { it.isNotBlank() },
                lastUpdatedAt = System.currentTimeMillis(),
            )
            toastRes(R.string.chat_vm_toast_compact_triggered)
            refreshSessionControl()
        }
        if (!ok) toastRes(R.string.chat_vm_toast_compact_send_failed_disconnected)
    }

    fun toggleMemory() {
        if (!requireActiveSession(s(R.string.chat_vm_action_toggle_memory))) return
        val target = !_sessionControl.value.memoryEnabled
        val ok = sendRpcRequest("memory_toggle", mapOf("enabled" to target)) { obj ->
            val err = rpcError(obj)
            if (err != null) {
                toastRes(R.string.chat_vm_toast_memory_toggle_failed_with_error, err)
                return@sendRpcRequest
            }
            val result = obj.optJSONObject("result") ?: JSONObject()
            _sessionControl.value = _sessionControl.value.copy(
                memoryEnabled = result.optBoolean("enabled", target),
                lastUpdatedAt = System.currentTimeMillis(),
            )
            toastRes(
                if (_sessionControl.value.memoryEnabled) {
                    R.string.chat_vm_toast_memory_enabled
                } else {
                    R.string.chat_vm_toast_memory_disabled
                }
            )
        }
        if (!ok) toastRes(R.string.chat_vm_toast_memory_toggle_send_failed_disconnected)
    }

    fun probeForeground(reason: String = "manual") {
        if (!requireActiveSession(s(R.string.chat_vm_action_probe))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return
        val activeRelay = relay ?: return
        if (!activeRelay.isConnected) {
            toastRes(R.string.chat_vm_toast_probe_offline)
            return
        }

        val now = System.currentTimeMillis()
        val probeId = java.util.UUID.randomUUID().toString().take(8)
        pendingProbeId = probeId
        pendingProbeSentAtMs = now
        val payload = JSONObject()
            .put("probeId", probeId)
            .put("clientTs", now)
            .put("reason", reason)
            .toString()
        runCatching {
            activeRelay.send(EnvelopeHelper.create(
                source = deviceId, target = "broadcast",
                sessionId = sessionId, type = "foreground_probe",
                plaintext = payload, sharedKey = key
            ))
            _foregroundProbe.value = _foregroundProbe.value.copy(
                status = "probing",
                latencyMs = null
            )
        }.onFailure {
            pendingProbeId = null
            pendingProbeSentAtMs = 0L
            toastRes(R.string.chat_vm_toast_probe_send_failed)
        }
    }

    /** 切换权限模式 */
    fun setPermissionMode(mode: PermissionMode) {
        rpc("set_permission_mode", mapOf("mode" to mode.value))
        updateAgentState(_agentState.value.copy(permissionMode = mode))
    }

    /** 切换模型模式 (default/sonnet/opus) */
    fun setModelMode(mode: ModelMode) {
        if (!requireActiveSession(s(R.string.chat_vm_action_switch_model))) return
        val key = keyStore.sharedKey ?: return
        val deviceId = keyStore.deviceId ?: return
        val sessionId = keyStore.sessionId ?: return

        val payload = JSONObject().put("mode", mode.value).toString()
        relay?.send(EnvelopeHelper.create(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = "model_mode",
            plaintext = payload, sharedKey = key
        ))
        updateAgentState(_agentState.value.copy(modelMode = mode))
    }

    // ── TTS 朗读 ──

    fun speak(text: String, index: Int) {
        ttsManager.onStateChange = { state ->
            Handler(Looper.getMainLooper()).post {
                _speakingIndex.value = if (state == TtsState.SPEAKING) index else -1
            }
        }
        ttsManager.speak(text, index)
    }

    fun stopSpeaking() {
        ttsManager.stop()
        _speakingIndex.value = -1
    }

    fun broadcastLatestReplyViaTts() {
        val lastAi = _items.value.lastOrNull { it is ChatItem.Text && it.role == "ai" } as? ChatItem.Text
        if (lastAi == null) {
            toastRes(R.string.chat_vm_toast_no_reply_to_read)
            return
        }
        val idx = _items.value.indexOf(lastAi)
        speak(lastAi.content, idx)
        toastRes(R.string.chat_vm_toast_start_tts_latest_reply)
    }

    /** 断线重连后恢复缺失消息 */
    private fun recoverMissedMessages() {
        if (recoveringMissedMessages) return
        val url = keyStore.serverUrl ?: return
        val token = keyStore.sessionToken ?: return
        val sid = keyStore.sessionId ?: return
        var afterTs = keyStore.lastSeenTs
        var afterCursor = keyStore.lastSeenCursor
        if (afterTs <= 0L && afterCursor <= 0L) return

        recoveringMissedMessages = true
        recoveryScope.launch {
            try {
                val api = ApiClient(url)
                val limit = 200
                var totalRecovered = 0
                var rounds = 0
                var previousCursor = afterCursor

                while (rounds < 20) {
                    rounds += 1
                    val missedResult = api.fetchMissedMessages(
                        sessionId = sid,
                        afterTs = afterTs,
                        token = token,
                        limit = limit,
                        afterCursor = afterCursor,
                    )
                    val missed = missedResult.messages
                    if (missed.isEmpty()) break

                    for (msg in missed) {
                        runCatching {
                            // 将持久化的密文消息还原为 envelope 格式
                            val msgSessionId = msg.optString("session_id", sid).ifBlank { sid }
                            val msgTarget = msg.optString("target", "broadcast").ifBlank { "broadcast" }
                            val msgTs = msg.optLong("ts", 0L)
                            if (msgTs > afterTs) afterTs = msgTs
                            val msgCursor = msg.optLong("cursor", 0L)
                            if (msgCursor > afterCursor) afterCursor = msgCursor

                            val env = JSONObject().apply {
                                put("id", msg.optString("id"))
                                put("type", msg.optString("type"))
                                put("ts", msgTs)
                                put("payload", msg.optString("payload"))
                                put("source", msg.optString("source"))
                                put("target", msgTarget)
                                put("sessionId", msgSessionId)
                                put("seq", msg.optInt("seq"))
                                if (msgCursor > 0L) put("cursor", msgCursor)
                            }
                            handleEnvelope(env)
                        }.onFailure { e ->
                            Log.w("Yuanio", "[chat] 跳过损坏恢复消息: ${e.message}")
                        }
                    }

                    totalRecovered += missed.size
                    if (missedResult.nextCursor > afterCursor) {
                        afterCursor = missedResult.nextCursor
                    }
                    if (afterCursor > keyStore.lastSeenCursor) keyStore.lastSeenCursor = afterCursor
                    if (afterTs > keyStore.lastSeenTs) keyStore.lastSeenTs = afterTs

                    if (missed.size < limit) break
                    if (afterCursor <= previousCursor && missedResult.nextCursor <= previousCursor) {
                        Log.w("Yuanio", "[chat] 恢复游标未推进，提前结束本轮恢复")
                        break
                    }
                    previousCursor = afterCursor
                }

                if (totalRecovered > 0) {
                    toastRes(R.string.chat_vm_toast_recovered_missed_messages, totalRecovered)
                }
            } catch (e: Exception) {
                toastRes(R.string.chat_vm_toast_recover_messages_failed, e.message ?: s(R.string.common_unknown))
            } finally {
                recoveringMissedMessages = false
            }
        }
    }

    /** 导出对话为 Markdown */
    fun exportMarkdown(): String {
        val sid = _viewSessionId.value ?: keyStore.sessionId ?: "unknown"
        return MessageExporter.toMarkdown(getApplication(), _items.value, sid)
    }

    override fun onCleared() {
        pendingPrompts.values.forEach { it.timeout?.let { r -> ackHandler.removeCallbacks(r) } }
        pendingPrompts.clear()
        pendingRpcCallbacks.clear()
        pendingApprovalCommits.values.forEach {
            it.commitJob?.cancel()
            PendingApprovalStore(getApplication()).append(it.approval.id, it.approved)
        }
        pendingApprovalCommits.clear()
        approvalAutoRejectJobs.values.forEach { it.cancel() }
        approvalAutoRejectJobs.clear()
        _approvalUndoState.value = null
        pendingHandoff = null
        _handoffRequest.value = null
        pendingProbeId = null
        pendingProbeSentAtMs = 0L
        streamCommitJob?.cancel()
        streamCommitJob = null
        vibingJob?.cancel()
        vibingJob = null
        ttsManager.release()
        sessionGateway.disconnect()
    }
}

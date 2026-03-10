package sy.yuanio.app.ui.screen

import android.app.Application
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import sy.yuanio.app.R
import sy.yuanio.app.YuanioApp
import sy.yuanio.app.data.ArtifactStore
import sy.yuanio.app.data.ChatHistory
import sy.yuanio.app.data.ConnectionMode
import sy.yuanio.app.data.KeyStore
import sy.yuanio.app.data.WorkflowApprovalSnapshot
import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowSnapshotStore
import sy.yuanio.app.data.WorkflowTaskSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class HomeViewModel(app: Application) : AndroidViewModel(app) {
    data class RecentSessionItem(
        val id: String,
        val title: String,
        val preview: String,
    )

    data class UiState(
        val activeProfile: String = "default",
        val serverUrl: String = "-",
        val activeSessionId: String? = null,
        val preferredSessionId: String? = null,
        val historySessionCount: Int = 0,
        val connectionMode: ConnectionMode = ConnectionMode.AUTO,
        val connectionType: String = "relay",
        val isConnected: Boolean = false,
        val runningTaskCount: Int = 0,
        val queuedTaskCount: Int = 0,
        val todoCount: Int = 0,
        val pendingApprovalCount: Int = 0,
        val queueMode: String = "sequential",
        val latestTaskSummary: WorkflowTaskSummary? = null,
        val latestResultSummary: WorkflowTaskSummary? = null,
        val latestTaskChatPreview: TaskChatActivityEntry? = null,
        val latestResultChatPreview: TaskChatActivityEntry? = null,
        val savedArtifactCount: Int = 0,
        val latestArtifactTitle: String? = null,
        val latestArtifactTypeLabel: String? = null,
        val firstPendingApproval: WorkflowApprovalSnapshot? = null,
        val pendingApprovalTaskChatPreview: TaskChatActivityEntry? = null,
        val focusedTaskId: String? = null,
        val focusedTaskKind: TaskRefreshFocusKind = TaskRefreshFocusKind.NONE,
        val focusedApprovalId: String? = null,
        val focusedApprovalKind: ApprovalRefreshFocusKind = ApprovalRefreshFocusKind.NONE,
        val recentSessions: List<RecentSessionItem> = emptyList(),
    )

    private val keyStore = KeyStore(app)
    private val history = ChatHistory(app)
    private val sessionGateway = (app as YuanioApp).sessionGateway

    private val _state = MutableStateFlow(buildState())
    val state = _state.asStateFlow()

    init {
        viewModelScope.launch {
            WorkflowSnapshotStore.snapshot.collect { snapshot ->
                _state.value = buildState(snapshot, WorkflowFocusStore.state.value)
            }
        }
        viewModelScope.launch {
            WorkflowFocusStore.state.collect { focusState ->
                _state.value = buildState(WorkflowSnapshotStore.snapshot.value, focusState)
            }
        }
    }

    fun refresh() {
        _state.value = buildState(WorkflowSnapshotStore.snapshot.value, WorkflowFocusStore.state.value)
    }

    private fun buildState(
        snapshotData: WorkflowSnapshot = WorkflowSnapshotStore.snapshot.value,
        focusState: WorkflowFocusState = WorkflowFocusStore.state.value,
    ): UiState {
        val snapshot = sessionGateway.snapshot()
        val sessions = history.sessionList()
        val savedArtifacts = ArtifactStore.loadAll()
        val latestArtifact = selectLatestResultArtifact(savedArtifacts)
        val latestTaskSummary = snapshotData.recentTaskSummaries.firstOrNull()
        val latestResultSummary = snapshotData.recentTaskSummaries.firstOrNull()
        val firstPendingApproval = snapshotData.pendingApprovals.firstOrNull()
        val previewSessionId = snapshotData.sessionId?.trim()?.ifBlank { null }
            ?: keyStore.lastViewedSessionId?.trim()?.ifBlank { null }
            ?: keyStore.sessionId?.trim()?.ifBlank { null }
        val taskChatEntries = previewSessionId?.let(history::loadEntries).orEmpty()
        val taskChatPreviewBinding = resolveHomeTaskChatPreviewBinding(
            entries = taskChatEntries,
            latestTaskId = latestTaskSummary?.taskId,
            latestResultTaskId = latestResultSummary?.taskId,
            pendingApprovalTaskId = firstPendingApproval?.taskId,
        )
        val latestArtifactTitle = latestArtifact?.let(::resolveResultArtifactTitle)
        val latestArtifactTypeLabel = latestArtifact
            ?.let(::resolveResultArtifactTypeLabel)
            ?.takeUnless { it == latestArtifactTitle }
        return UiState(
            activeProfile = keyStore.activeProfile,
            serverUrl = keyStore.serverUrl ?: "-",
            activeSessionId = keyStore.sessionId,
            preferredSessionId = keyStore.lastViewedSessionId ?: keyStore.sessionId,
            historySessionCount = sessions.size,
            connectionMode = snapshot.preferredConnectionMode,
            connectionType = snapshot.connectionType,
            isConnected = snapshot.isConnected,
            runningTaskCount = snapshotData.runningTaskCount,
            queuedTaskCount = snapshotData.queuedTaskCount,
            todoCount = snapshotData.todos.size,
            pendingApprovalCount = snapshotData.pendingApprovalCount,
            queueMode = snapshotData.queueMode,
            latestTaskSummary = latestTaskSummary,
            latestResultSummary = latestResultSummary,
            latestTaskChatPreview = taskChatPreviewBinding.latestTaskPreview,
            latestResultChatPreview = taskChatPreviewBinding.latestResultPreview,
            savedArtifactCount = savedArtifacts.size,
            latestArtifactTitle = latestArtifactTitle,
            latestArtifactTypeLabel = latestArtifactTypeLabel,
            firstPendingApproval = firstPendingApproval,
            pendingApprovalTaskChatPreview = taskChatPreviewBinding.pendingApprovalTaskPreview,
            focusedTaskId = focusState.task.taskId,
            focusedTaskKind = focusState.task.kind,
            focusedApprovalId = focusState.approval.approvalId,
            focusedApprovalKind = focusState.approval.kind,
            recentSessions = sessions.take(3).map {
                RecentSessionItem(
                    id = it.id,
                    title = it.title.ifBlank { it.id.take(8) },
                    preview = it.preview,
                )
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenCurrentSession: (String?) -> Unit,
    onOpenSessions: () -> Unit,
    onOpenTerminal: () -> Unit,
    onOpenEnvironment: () -> Unit,
    onOpenFiles: () -> Unit,
    onOpenSkills: () -> Unit,
    onOpenTasks: () -> Unit,
    onOpenTaskSummary: (TaskRefreshFocusKind, String?) -> Unit,
    onOpenApprovals: () -> Unit,
    onOpenTaskDetail: (String) -> Unit,
    onOpenResults: () -> Unit,
    onOpenArtifactCenter: () -> Unit,
    onOpenResultDetail: (String) -> Unit,
    onOpenApprovalDetail: (String) -> Unit,
    vm: HomeViewModel = viewModel(),
) {
    val context = LocalContext.current
    val state by vm.state.collectAsStateWithLifecycle()
    val taskRefreshState = rememberWorkflowRefreshUiState(command = "/tasks")
    val approvalRefreshState = rememberWorkflowRefreshUiState(command = "/approvals")
    val homeRefreshState = rememberWorkflowRefreshUiState(commands = listOf("/tasks", "/approvals"))
    val homeRefreshHighlightTargets = resolveHomeRefreshHighlightTargets(state)
    val taskRefreshHighlighted = rememberTransientHighlight(taskRefreshState.successfulRefreshCount)
    val approvalRefreshHighlighted = rememberTransientHighlight(approvalRefreshState.successfulRefreshCount)
    val homeRefreshHighlighted = rememberTransientHighlight(homeRefreshState.successfulRefreshCount)
    val taskFocusHighlighted = rememberTransientHighlight(resolveHomeTaskFocusPulseKey(state))
    val approvalFocusHighlighted = rememberTransientHighlight(resolveHomeApprovalFocusPulseKey(state))
    val highlightTaskSummaryCard = taskRefreshHighlighted || taskFocusHighlighted || (
        homeRefreshHighlighted && homeRefreshHighlightTargets.highlightTasks
    )
    val highlightApprovalSummaryCard = approvalRefreshHighlighted || approvalFocusHighlighted || (
        homeRefreshHighlighted && homeRefreshHighlightTargets.highlightApprovals
    )
    val highlightResultSummaryCard = highlightTaskSummaryCard
    val currentResultTaskId = resolveHomeResultTaskId(
        focusedTaskId = state.focusedTaskId,
        latestResultSummary = state.latestResultSummary,
    )

    LaunchedEffect(Unit) {
        vm.refresh()
    }

    LaunchedEffect(homeRefreshState.successfulRefreshCount) {
        if (homeRefreshState.successfulRefreshCount <= 0L) return@LaunchedEffect
        val summary = resolveHomeRefreshSummary(state)
        val message = when (summary.kind) {
            HomeRefreshSummaryKind.EMPTY -> context.getString(R.string.home_refresh_summary_empty)
            HomeRefreshSummaryKind.COUNTS -> context.getString(
                R.string.home_refresh_summary_counts,
                summary.runningTaskCount,
                summary.queuedTaskCount,
                summary.pendingApprovalCount,
            )
        }
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.home_title))
                        Text(
                            stringResource(R.string.home_subtitle),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                },
                actions = {
                    WorkflowRefreshActionButton(refreshState = homeRefreshState)
                }
            )
        }
    ) { padding ->
        WorkflowRefreshContainer(
            refreshState = homeRefreshState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                HomeSectionCard(title = stringResource(R.string.home_section_connection)) {
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_active_profile),
                        value = state.activeProfile,
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_connection),
                        value = buildConnectionSummary(
                            isConnected = state.isConnected,
                            connectionType = state.connectionType,
                            mode = state.connectionMode,
                        )
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_server),
                        value = state.serverUrl,
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_session_count),
                        value = state.historySessionCount.toString(),
                    )
                }
            }

            item {
                HomeSectionCard(title = stringResource(R.string.home_label_last_session)) {
                    Text(
                        text = state.preferredSessionId ?: "-",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = { onOpenCurrentSession(state.preferredSessionId) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(stringResource(R.string.home_action_continue))
                        }
                        OutlinedButton(
                            onClick = onOpenSessions,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(stringResource(R.string.home_action_open_sessions))
                        }
                    }
                }
            }

            item {
                HomeSectionCard(title = stringResource(R.string.home_section_quick_actions)) {
                    HomeActionRow(
                        leftLabel = stringResource(R.string.home_action_open_terminal),
                        rightLabel = stringResource(R.string.home_action_open_environment),
                        onLeft = onOpenTerminal,
                        onRight = onOpenEnvironment,
                    )
                    Spacer(Modifier.height(8.dp))
                    HomeActionRow(
                        leftLabel = stringResource(R.string.home_action_open_files),
                        rightLabel = stringResource(R.string.home_action_open_skills),
                        onLeft = onOpenFiles,
                        onRight = onOpenSkills,
                    )
                }
            }

            item {
                val latestTaskSummary = state.latestTaskSummary
                HomeSectionCard(
                    title = stringResource(R.string.home_section_tasks),
                    modifier = Modifier.clickable {
                        when {
                            state.focusedTaskKind != TaskRefreshFocusKind.NONE && !state.focusedTaskId.isNullOrBlank() -> {
                                onOpenTaskSummary(state.focusedTaskKind, state.focusedTaskId)
                            }
                            latestTaskSummary != null -> {
                                onOpenTaskSummary(TaskRefreshFocusKind.LATEST_SUMMARY, latestTaskSummary.taskId)
                            }
                            else -> onOpenTasks()
                        }
                    },
                    highlighted = highlightTaskSummaryCard,
                    action = {
                        WorkflowRefreshActionButton(refreshState = taskRefreshState)
                    },
                ) {
                    val latestTaskSummary = state.latestTaskSummary
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_running_tasks),
                        value = state.runningTaskCount.toString(),
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_queued_tasks),
                        value = state.queuedTaskCount.toString(),
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_todo_count),
                        value = state.todoCount.toString(),
                    )
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_queue_mode),
                        value = buildQueueModeLabel(state.queueMode),
                    )
                    if (!state.focusedTaskId.isNullOrBlank() && state.focusedTaskKind != TaskRefreshFocusKind.NONE) {
                        HomeInfoRow(
                            label = stringResource(R.string.home_label_current_focus),
                            value = buildHomeTaskFocusLabel(
                                focusKind = state.focusedTaskKind,
                                taskId = state.focusedTaskId,
                            ),
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    if (latestTaskSummary != null) {
                        HomeInfoRow(
                            label = stringResource(R.string.home_label_latest_task),
                            value = latestTaskSummary.taskId,
                        )
                        if (latestTaskSummary.totalTokens > 0) {
                            HomeInfoRow(
                                label = stringResource(R.string.home_label_last_tokens),
                                value = latestTaskSummary.totalTokens.toString(),
                            )
                        }
                        state.latestTaskChatPreview?.let { preview ->
                            Spacer(Modifier.height(4.dp))
                            TaskChatPreviewSection(preview = preview)
                        }
                    } else {
                        Text(
                            text = stringResource(R.string.home_empty_task_summary),
                            color = MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    if (latestTaskSummary != null) {
                        HomeActionRow(
                            leftLabel = stringResource(R.string.home_action_open_tasks),
                            rightLabel = stringResource(R.string.home_action_open_latest_result),
                            onLeft = onOpenTasks,
                            onRight = { onOpenResultDetail(latestTaskSummary.taskId) },
                        )
                    } else {
                        OutlinedButton(
                            onClick = onOpenTasks,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(stringResource(R.string.home_action_open_tasks))
                        }
                    }
                }
            }

            item {
                val latestResultSummary = state.latestResultSummary
                HomeSectionCard(
                    title = stringResource(R.string.results_title),
                    modifier = Modifier.clickable {
                        if (currentResultTaskId.isNullOrBlank()) {
                            onOpenResults()
                        } else {
                            onOpenResultDetail(currentResultTaskId)
                        }
                    },
                    highlighted = highlightResultSummaryCard,
                    action = {
                        WorkflowRefreshActionButton(refreshState = taskRefreshState)
                    },
                ) {
                    if (latestResultSummary != null) {
                        HomeInfoRow(
                            label = stringResource(R.string.results_label_task_id),
                            value = latestResultSummary.taskId,
                        )
                        HomeInfoRow(
                            label = stringResource(R.string.results_label_duration),
                            value = formatHomeResultDuration(latestResultSummary.durationMs),
                        )
                        HomeInfoRow(
                            label = stringResource(R.string.results_label_files_changed),
                            value = latestResultSummary.filesChanged.toString(),
                        )
                        HomeInfoRow(
                            label = stringResource(R.string.results_label_total_tokens),
                            value = latestResultSummary.totalTokens.toString(),
                        )
                        if (latestResultSummary.gitStat.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = latestResultSummary.gitStat,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        state.latestResultChatPreview?.let { preview ->
                            Spacer(Modifier.height(4.dp))
                            TaskChatPreviewSection(preview = preview)
                        }
                        Spacer(Modifier.height(8.dp))
                        HomeActionRow(
                            leftLabel = stringResource(R.string.home_action_open_results),
                            rightLabel = stringResource(R.string.home_action_open_current_result),
                            onLeft = onOpenResults,
                            onRight = {
                                if (currentResultTaskId.isNullOrBlank()) {
                                    onOpenResults()
                                } else {
                                    onOpenResultDetail(currentResultTaskId)
                                }
                            },
                        )
                    } else {
                        Text(
                            text = stringResource(R.string.home_empty_result_summary),
                            color = MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = onOpenResults,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(stringResource(R.string.home_action_open_results))
                        }
                    }
                }
            }

            item {
                val latestArtifactTitle = state.latestArtifactTitle
                val latestArtifactTypeLabel = state.latestArtifactTypeLabel
                HomeSectionCard(
                    title = stringResource(R.string.home_section_artifacts),
                    modifier = Modifier.clickable(onClick = onOpenArtifactCenter),
                ) {
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_saved_artifacts),
                        value = state.savedArtifactCount.toString(),
                    )
                    if (!latestArtifactTitle.isNullOrBlank()) {
                        HomeInfoRow(
                            label = stringResource(R.string.home_label_latest_artifact),
                            value = latestArtifactTitle,
                        )
                        if (!latestArtifactTypeLabel.isNullOrBlank()) {
                            HomeInfoRow(
                                label = stringResource(R.string.home_label_latest_artifact_type),
                                value = latestArtifactTypeLabel,
                            )
                        }
                    } else {
                        Text(
                            text = stringResource(R.string.home_empty_artifact_summary),
                            color = MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onOpenArtifactCenter,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.home_action_open_artifact_center))
                    }
                }
            }

            item {
                HomeSectionCard(
                    title = stringResource(R.string.home_section_approvals),
                    modifier = Modifier.clickable {
                        val approvalId = state.focusedApprovalId ?: state.firstPendingApproval?.id
                        if (approvalId.isNullOrBlank()) {
                            onOpenApprovals()
                        } else {
                            onOpenApprovalDetail(approvalId)
                        }
                    },
                    highlighted = highlightApprovalSummaryCard,
                    action = {
                        WorkflowRefreshActionButton(refreshState = approvalRefreshState)
                    },
                ) {
                    val firstPendingApproval = state.firstPendingApproval
                    HomeInfoRow(
                        label = stringResource(R.string.home_label_pending_approvals),
                        value = state.pendingApprovalCount.toString(),
                    )
                    if (!state.focusedApprovalId.isNullOrBlank() && state.focusedApprovalKind != ApprovalRefreshFocusKind.NONE) {
                        HomeInfoRow(
                            label = stringResource(R.string.home_label_current_focus),
                            value = buildHomeApprovalFocusLabel(
                                focusKind = state.focusedApprovalKind,
                                approvalId = state.focusedApprovalId,
                            ),
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    if (firstPendingApproval != null) {
                        Text(
                            text = firstPendingApproval.desc,
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (firstPendingApproval.riskSummary.isNotBlank()) {
                            Text(
                                text = firstPendingApproval.riskSummary,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        state.pendingApprovalTaskChatPreview?.let { preview ->
                            Spacer(Modifier.height(4.dp))
                            TaskChatPreviewSection(preview = preview)
                        }
                    } else {
                        Text(
                            text = stringResource(R.string.home_empty_approval_summary),
                            color = MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    if (firstPendingApproval != null) {
                        HomeActionRow(
                            leftLabel = stringResource(R.string.home_action_open_approvals),
                            rightLabel = stringResource(R.string.home_action_open_current_approval),
                            onLeft = onOpenApprovals,
                            onRight = { onOpenApprovalDetail(firstPendingApproval.id) },
                        )
                    } else {
                        HomeActionRow(
                            leftLabel = stringResource(R.string.home_action_open_approvals),
                            rightLabel = stringResource(R.string.home_action_open_tasks),
                            onLeft = onOpenApprovals,
                            onRight = onOpenTasks,
                        )
                    }
                }
            }

                item {
                    Text(
                        text = stringResource(R.string.home_section_recent_sessions),
                        style = MaterialTheme.typography.titleMedium,
                    )
                }

                if (state.recentSessions.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.home_empty_recent_sessions),
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                } else {
                    items(state.recentSessions, key = { it.id }) { session ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenCurrentSession(session.id) },
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surface
                            )
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(
                                    text = session.title,
                                    style = MaterialTheme.typography.titleSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = session.id,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.outline,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (session.preview.isNotBlank()) {
                                    Text(
                                        text = session.preview,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeSectionCard(
    title: String,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    action: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val containerColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "homeSectionCardContainerColor",
    )
    val borderColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
        } else {
            Color.Transparent
        },
        label = "homeSectionCardBorderColor",
    )

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = containerColor
        ),
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                )
                action?.invoke()
            }
            content()
        }
    }
}

@Composable
private fun HomeInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.outline,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun HomeActionRow(
    leftLabel: String,
    rightLabel: String,
    onLeft: () -> Unit,
    onRight: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedButton(
            onClick = onLeft,
            modifier = Modifier.weight(1f),
        ) {
            Text(leftLabel)
        }
        OutlinedButton(
            onClick = onRight,
            modifier = Modifier.weight(1f),
        ) {
            Text(rightLabel)
        }
    }
}

@Composable
private fun buildConnectionSummary(
    isConnected: Boolean,
    connectionType: String,
    mode: ConnectionMode,
): String {
    val status = if (isConnected) {
        stringResource(R.string.environment_health_connected)
    } else {
        stringResource(R.string.environment_health_disconnected)
    }
    val gateway = when (connectionType.lowercase()) {
        "local" -> stringResource(R.string.connection_mode_local_label)
        else -> stringResource(R.string.connection_mode_relay_label)
    }
    val preferred = stringResource(mode.labelRes)
    return "$status · $gateway · $preferred"
}

private fun formatHomeResultDuration(durationMs: Long): String {
    if (durationMs <= 0L) return "0ms"
    return if (durationMs < 1000L) {
        "${durationMs}ms"
    } else {
        String.format("%.1fs", durationMs / 1000f)
    }
}

@Composable
private fun buildHomeTaskFocusLabel(
    focusKind: TaskRefreshFocusKind,
    taskId: String?,
): String {
    val normalizedTaskId = taskId?.trim().orEmpty().ifBlank { "-" }
    return when (focusKind) {
        TaskRefreshFocusKind.LATEST_SUMMARY -> stringResource(R.string.home_task_focus_latest_summary, normalizedTaskId)
        TaskRefreshFocusKind.RUNNING_TASK -> stringResource(R.string.home_task_focus_running, normalizedTaskId)
        TaskRefreshFocusKind.QUEUED_TASK -> stringResource(R.string.home_task_focus_queued, normalizedTaskId)
        TaskRefreshFocusKind.NONE -> normalizedTaskId
    }
}

@Composable
private fun buildHomeApprovalFocusLabel(
    focusKind: ApprovalRefreshFocusKind,
    approvalId: String?,
): String {
    val normalizedApprovalId = approvalId?.trim().orEmpty().ifBlank { "-" }
    return when (focusKind) {
        ApprovalRefreshFocusKind.FOCUSED_APPROVAL -> stringResource(R.string.home_approval_focus_targeted, normalizedApprovalId)
        ApprovalRefreshFocusKind.FIRST_APPROVAL -> stringResource(R.string.home_approval_focus_first, normalizedApprovalId)
        ApprovalRefreshFocusKind.NONE -> normalizedApprovalId
    }
}

@Composable
private fun buildQueueModeLabel(queueMode: String): String {
    return when (queueMode.lowercase()) {
        "parallel" -> stringResource(R.string.home_queue_mode_parallel)
        else -> stringResource(R.string.home_queue_mode_sequential)
    }
}


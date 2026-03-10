package sy.yuanio.app.ui.screen

import android.text.format.DateFormat
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import sy.yuanio.app.R
import sy.yuanio.app.data.ChatHistory
import sy.yuanio.app.data.WorkflowQueuedTask
import sy.yuanio.app.data.WorkflowSnapshot
import sy.yuanio.app.data.WorkflowSnapshotStore
import sy.yuanio.app.data.WorkflowTaskSummary
import sy.yuanio.app.ui.component.TodoCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskCenterScreen(
    onBack: () -> Unit,
    onOpenTaskDetail: (String) -> Unit,
    onOpenTaskResult: (String) -> Unit,
    onOpenHome: () -> Unit,
    onOpenChat: () -> Unit,
    requestedFocus: String? = null,
    requestedTaskId: String? = null,
) {
    val context = LocalContext.current
    val chatHistory = remember(context) { ChatHistory(context) }
    val snapshot by WorkflowSnapshotStore.snapshot.collectAsStateWithLifecycle()
    val refreshState = rememberWorkflowRefreshUiState(command = "/tasks")
    val listState = rememberLazyListState()
    var consumedRequestedFocus by remember(requestedFocus, requestedTaskId) { mutableStateOf(false) }
    var focusHighlightToken by remember { mutableStateOf(0L) }
    var focusHighlightKind by remember { mutableStateOf(TaskRefreshFocusKind.NONE) }
    var focusHighlightTaskId by remember { mutableStateOf<String?>(null) }
    val focusHighlightTarget = resolveTaskFocusHighlightTarget(
        snapshot = snapshot,
        focusKind = focusHighlightKind,
        preferredTaskId = focusHighlightTaskId,
    )
    val focusHighlighted = rememberTransientHighlight(focusHighlightToken)
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var filterModeName by rememberSaveable { mutableStateOf(TaskCenterFilterMode.ALL.name) }
    val filterMode = remember(filterModeName) { TaskCenterFilterMode.valueOf(filterModeName) }
    val normalizedRequestedTaskId = requestedTaskId?.trim().orEmpty().ifBlank { null }
    val taskChatHistoryEntries = remember(snapshot.sessionId, snapshot.updatedAt) {
        val sessionId = snapshot.sessionId?.trim().orEmpty()
        if (sessionId.isBlank()) {
            emptyList()
        } else {
            chatHistory.loadEntries(sessionId)
        }
    }
    val taskChatPreviewMap = remember(taskChatHistoryEntries) { buildTaskChatActivityMap(taskChatHistoryEntries) }
    val filteredSnapshot = remember(snapshot, searchQuery, filterMode, taskChatPreviewMap) {
        filterTaskCenterSnapshot(
            snapshot = snapshot,
            query = searchQuery,
            mode = filterMode,
            taskChatPreviewMap = taskChatPreviewMap,
        )
    }
    val hasRawContent = remember(snapshot) { hasTaskCenterContent(snapshot) }
    val hasFilteredContent = remember(filteredSnapshot) { hasTaskCenterContent(filteredSnapshot) }
    val filterActive = searchQuery.isNotBlank() || filterMode != TaskCenterFilterMode.ALL
    val requestedTaskChatTimeline = remember(taskChatHistoryEntries, normalizedRequestedTaskId) {
        normalizedRequestedTaskId?.let { buildTaskChatTimeline(taskChatHistoryEntries, it) } ?: emptyList()
    }
    val pinnedSummaryIds = remember(normalizedRequestedTaskId, focusHighlightTarget.latestTaskId) {
        listOfNotNull(normalizedRequestedTaskId, focusHighlightTarget.latestTaskId).distinct()
    }
    val summarySections = remember(filteredSnapshot.recentTaskSummaries, pinnedSummaryIds) {
        splitTaskSummariesForDisplay(
            summaries = filteredSnapshot.recentTaskSummaries,
            pinnedTaskIds = pinnedSummaryIds,
        )
    }

    LaunchedEffect(requestedFocus, requestedTaskId, snapshot.updatedAt, consumedRequestedFocus) {
        if (consumedRequestedFocus) return@LaunchedEffect
        val target = resolveRequestedTaskScrollTarget(
            requestedFocus = requestedFocus,
            requestedTaskId = requestedTaskId,
            snapshot = snapshot,
        ) ?: return@LaunchedEffect
        listState.animateScrollToItem(target.index)
        if (target.focusKind != TaskRefreshFocusKind.NONE) {
            Toast.makeText(context, context.getString(R.string.workflow_refresh_focus_tasks_latest), Toast.LENGTH_SHORT).show()
            WorkflowFocusStore.setTaskFocus(target.focusKind, target.taskId)
            focusHighlightKind = target.focusKind
            focusHighlightTaskId = target.taskId
            focusHighlightToken += 1L
        } else {
            WorkflowFocusStore.clearTaskFocus()
            focusHighlightTaskId = null
        }
        consumedRequestedFocus = true
    }

    LaunchedEffect(refreshState.successfulRefreshCount, snapshot.updatedAt) {
        if (refreshState.successfulRefreshCount <= 0L) return@LaunchedEffect
        val target = resolveTaskRefreshScrollTarget(snapshot)
        listState.animateScrollToItem(target.index)
        if (target.focusKind != TaskRefreshFocusKind.NONE) {
            Toast.makeText(context, context.getString(R.string.workflow_refresh_focus_tasks_latest), Toast.LENGTH_SHORT).show()
            WorkflowFocusStore.setTaskFocus(target.focusKind, target.taskId)
            focusHighlightKind = target.focusKind
            focusHighlightTaskId = target.taskId
            focusHighlightToken += 1L
        } else {
            WorkflowFocusStore.clearTaskFocus()
            focusHighlightTaskId = null
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.tasks_title))
                        Text(
                            text = stringResource(R.string.tasks_subtitle),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_arrow_left),
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                actions = {
                    WorkflowRefreshActionButton(refreshState = refreshState)
                }
            )
        }
    ) { padding ->
        WorkflowRefreshContainer(
            refreshState = refreshState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    TaskInfoCard(title = stringResource(R.string.tasks_section_overview)) {
                        TaskInfoRow(
                            label = stringResource(R.string.home_label_running_tasks),
                            value = snapshot.runningTaskCount.toString(),
                        )
                        TaskInfoRow(
                            label = stringResource(R.string.home_label_queued_tasks),
                            value = snapshot.queuedTaskCount.toString(),
                        )
                        TaskInfoRow(
                            label = stringResource(R.string.home_label_todo_count),
                            value = snapshot.todos.size.toString(),
                        )
                        TaskInfoRow(
                            label = stringResource(R.string.home_label_pending_approvals),
                            value = snapshot.pendingApprovalCount.toString(),
                        )
                        TaskInfoRow(
                            label = stringResource(R.string.home_label_queue_mode),
                            value = when (snapshot.queueMode.lowercase()) {
                                "parallel" -> stringResource(R.string.home_queue_mode_parallel)
                                else -> stringResource(R.string.home_queue_mode_sequential)
                            },
                        )
                    }
                }

                item {
                    TaskSearchAndFilterCard(
                        searchQuery = searchQuery,
                        onSearchQueryChange = { searchQuery = it },
                        filterMode = filterMode,
                        onFilterModeChange = { filterModeName = it.name },
                    )
                }

                if (filteredSnapshot.todos.isNotEmpty()) {
                    item {
                        TodoCard(todos = filteredSnapshot.todos)
                    }
                }

                if (normalizedRequestedTaskId != null) {
                    item {
                        TaskInfoCard(title = stringResource(R.string.chat_timeline_title)) {
                            if (requestedTaskChatTimeline.isEmpty()) {
                                Text(
                                    text = stringResource(R.string.chat_timeline_empty),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            } else {
                                requestedTaskChatTimeline.forEach { entry ->
                                    TaskChatActivityCard(
                                        entry = entry,
                                        onClick = { onOpenTaskDetail(entry.taskId) },
                                    )
                                }
                            }
                        }
                    }
                }

                if (filteredSnapshot.queuedTasks.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.tasks_section_queue),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    items(filteredSnapshot.queuedTasks, key = { it.id }) { task ->
                        QueueTaskCard(
                            task = task,
                            highlighted = focusHighlighted && focusHighlightTarget.queuedTaskId == task.id,
                            activityPreview = taskChatPreviewMap[task.id],
                        )
                    }
                }

                if (filteredSnapshot.runningTaskIds.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.tasks_section_running),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    items(filteredSnapshot.runningTaskIds, key = { it }) { taskId ->
                        TaskIdCard(
                            taskId = taskId,
                            subtitle = stringResource(R.string.tasks_running_hint),
                            activityPreview = taskChatPreviewMap[taskId],
                            highlighted = focusHighlighted && focusHighlightTarget.runningTaskId == taskId,
                            onClick = { onOpenTaskDetail(taskId) },
                        )
                    }
                }

                if (summarySections.pinned.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.tasks_section_pinned_summary),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    items(summarySections.pinned, key = { it.taskId }) { summary ->
                        TaskSummaryCard(
                            summary = summary,
                            activityPreview = taskChatPreviewMap[summary.taskId],
                            highlighted = focusHighlighted && focusHighlightTarget.latestTaskId == summary.taskId,
                            onClick = { onOpenTaskResult(summary.taskId) },
                        )
                    }
                }

                if (summarySections.recent.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.tasks_section_recent_summary),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    items(summarySections.recent, key = { it.taskId }) { summary ->
                        TaskSummaryCard(
                            summary = summary,
                            activityPreview = taskChatPreviewMap[summary.taskId],
                            highlighted = focusHighlighted && focusHighlightTarget.latestTaskId == summary.taskId,
                            onClick = { onOpenTaskResult(summary.taskId) },
                        )
                    }
                }

                if (!hasFilteredContent) {
                    item {
                        TaskEmptyStateCard(
                            message = stringResource(
                                if (filterActive && hasRawContent) R.string.tasks_filter_empty else R.string.tasks_empty,
                            ),
                            onOpenHome = onOpenHome,
                            onOpenChat = onOpenChat,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskEmptyStateCard(
    message: String,
    onOpenHome: () -> Unit,
    onOpenChat: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(text = message, color = MaterialTheme.colorScheme.outline)
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(onClick = onOpenHome, modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.empty_state_action_home))
                }
                OutlinedButton(onClick = onOpenChat, modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.empty_state_action_chat))
                }
            }
        }
    }
}

@Composable
private fun TaskInfoCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun TaskInfoRow(label: String, value: String) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall)
        Text(text = value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun TaskSearchAndFilterCard(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    filterMode: TaskCenterFilterMode,
    onFilterModeChange: (TaskCenterFilterMode) -> Unit,
) {
    TaskInfoCard(title = stringResource(R.string.chat_topbar_menu_search)) {
        OutlinedTextField(
            value = searchQuery,
            onValueChange = onSearchQueryChange,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text(stringResource(R.string.tasks_search_placeholder)) },
            leadingIcon = {
                Icon(
                    painter = painterResource(R.drawable.ic_tb_search),
                    contentDescription = stringResource(R.string.chat_topbar_menu_search),
                )
            },
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surface,
                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            ),
        )
        androidx.compose.foundation.layout.Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TaskCenterFilterMode.entries.forEach { mode ->
                FilterChip(
                    selected = mode == filterMode,
                    onClick = { onFilterModeChange(mode) },
                    label = { Text(text = taskCenterFilterLabel(mode)) },
                )
            }
        }
    }
}

@Composable
private fun taskCenterFilterLabel(mode: TaskCenterFilterMode): String {
    return when (mode) {
        TaskCenterFilterMode.ALL -> stringResource(R.string.tasks_filter_all)
        TaskCenterFilterMode.RUNNING -> stringResource(R.string.tasks_filter_running)
        TaskCenterFilterMode.QUEUED -> stringResource(R.string.tasks_filter_queued)
        TaskCenterFilterMode.RECENT -> stringResource(R.string.tasks_filter_recent)
    }
}

private fun hasTaskCenterContent(snapshot: WorkflowSnapshot): Boolean {
    return snapshot.todos.isNotEmpty()
        || snapshot.queuedTasks.isNotEmpty()
        || snapshot.runningTaskIds.isNotEmpty()
        || snapshot.recentTaskSummaries.isNotEmpty()
}

@Composable
private fun QueueTaskCard(
    task: WorkflowQueuedTask,
    activityPreview: TaskChatActivityEntry? = null,
    highlighted: Boolean = false,
) {
    TaskFocusCard(highlighted = highlighted) {
        Text(
            text = task.prompt,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = stringResource(R.string.tasks_queue_meta, task.id, task.agent ?: "-", task.priority),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        TaskChatPreviewText(activityPreview)
    }
}

@Composable
private fun TaskIdCard(
    taskId: String,
    subtitle: String,
    activityPreview: TaskChatActivityEntry? = null,
    highlighted: Boolean = false,
    onClick: () -> Unit,
) {
    TaskFocusCard(
        highlighted = highlighted,
        onClick = onClick,
    ) {
        Text(
            text = taskId,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        TaskChatPreviewText(activityPreview)
    }
}

@Composable
private fun TaskSummaryCard(
    summary: WorkflowTaskSummary,
    activityPreview: TaskChatActivityEntry? = null,
    highlighted: Boolean = false,
    onClick: () -> Unit,
) {
    TaskFocusCard(
        highlighted = highlighted,
        onClick = onClick,
    ) {
        Text(
            text = summary.taskId,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = stringResource(
                R.string.tasks_summary_metrics,
                formatDuration(summary.durationMs),
                summary.filesChanged,
                summary.totalTokens,
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (summary.gitStat.isNotBlank()) {
            Text(
                text = summary.gitStat,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
        TaskChatPreviewText(activityPreview)
    }
}

@Composable
private fun TaskChatActivityCard(
    entry: TaskChatActivityEntry,
    onClick: () -> Unit,
) {
    TaskFocusCard(highlighted = false, onClick = onClick) {
        Text(
            text = if (entry.ts > 0L) "${entry.role} · ${DateFormat.format("HH:mm", entry.ts)}" else entry.role,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
        if (!entry.agent.isNullOrBlank()) {
            Text(
                text = entry.agent,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Text(
            text = entry.summary,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TaskChatPreviewText(activityPreview: TaskChatActivityEntry?) {
    val preview = activityPreview ?: return
    Spacer(Modifier.height(2.dp))
    Text(
        text = preview.summary,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.outline,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun TaskFocusCard(
    highlighted: Boolean,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val containerColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "taskFocusCardContainerColor",
    )
    val borderColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
        } else {
            Color.Transparent
        },
        label = "taskFocusCardBorderColor",
    )
    val cardModifier = if (onClick == null) {
        Modifier.fillMaxWidth()
    } else {
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    }

    Card(
        modifier = cardModifier,
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            content()
        }
    }
}

private fun formatDuration(durationMs: Long): String {
    if (durationMs <= 0L) return "0ms"
    return if (durationMs < 1000L) {
        "${durationMs}ms"
    } else {
        String.format("%.1fs", durationMs / 1000f)
    }
}


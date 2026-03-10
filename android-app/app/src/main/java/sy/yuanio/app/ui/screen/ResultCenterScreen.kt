package sy.yuanio.app.ui.screen

import android.content.ClipData
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import sy.yuanio.app.R
import sy.yuanio.app.data.Artifact
import sy.yuanio.app.data.ArtifactStore
import sy.yuanio.app.data.ChatHistory
import sy.yuanio.app.data.MessageExporter
import sy.yuanio.app.data.WorkflowSnapshotStore
import sy.yuanio.app.data.WorkflowTaskSummary
import sy.yuanio.app.data.sendAgentCommand
import sy.yuanio.app.ui.component.ArtifactCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultCenterScreen(
    onBack: () -> Unit,
    onOpenTaskDetail: (String) -> Unit,
    onOpenFiles: (String?, String?) -> Unit,
    onOpenGit: (String?, String?) -> Unit,
    onOpenArtifactOrigin: (String?, String?) -> Unit,
    onOpenHome: () -> Unit,
    requestedTaskId: String? = null,
    requestedMode: String? = null,
) {
    val snapshot by WorkflowSnapshotStore.snapshot.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val chatHistory = remember(context) { ChatHistory(context) }
    var activeTaskId by remember(requestedTaskId) { mutableStateOf(requestedTaskId?.trim().orEmpty()) }
    var artifactVersion by remember { mutableStateOf(0) }
    var activeModeName by rememberSaveable(requestedMode) {
        mutableStateOf(resolveResultCenterMode(requestedMode).name)
    }
    var artifactSearchQuery by rememberSaveable { mutableStateOf("") }
    var artifactFilterModeName by rememberSaveable { mutableStateOf(ResultArtifactFilterMode.ALL.name) }
    val activeMode = remember(activeModeName) { ResultCenterMode.valueOf(activeModeName) }
    val artifactFilterMode = remember(artifactFilterModeName) { ResultArtifactFilterMode.valueOf(artifactFilterModeName) }
    val selection = resolveResultSummarySelection(activeTaskId, snapshot)
    val selectedSummary = selection.selectedSummary
    val selectedTaskId = selectedSummary?.taskId
    val taskChatEntries = remember(chatHistory, snapshot.sessionId) {
        snapshot.sessionId?.trim()?.takeIf { it.isNotBlank() }?.let(chatHistory::loadEntries).orEmpty()
    }
    val selectedTaskChatPreview = remember(taskChatEntries, selectedTaskId) {
        resolveResultTaskChatPreview(taskChatEntries, selectedTaskId)
    }
    val allArtifacts = remember(artifactVersion) {
        ArtifactStore.loadAll()
    }
    val taskScopedArtifacts = remember(allArtifacts, selectedTaskId) {
        filterArtifactsForTask(allArtifacts, selectedTaskId)
    }
    val resultFileQuery = buildResultFileQuery(selectedSummary, taskScopedArtifacts)
    val resultGitTab = resolveResultGitTab(selectedSummary, taskScopedArtifacts).routeValue
    val recentArtifacts = remember(allArtifacts, taskScopedArtifacts) {
        selectRecentArtifacts(
            artifacts = taskScopedArtifacts.ifEmpty { allArtifacts },
            limit = 2,
        )
    }
    val filteredArtifacts = remember(allArtifacts, artifactSearchQuery, artifactFilterMode) {
        filterResultArtifacts(
            artifacts = allArtifacts,
            query = artifactSearchQuery,
            mode = artifactFilterMode,
        )
    }
    val groupedArtifacts = remember(filteredArtifacts) { groupResultArtifacts(filteredArtifacts) }
    val artifactStats = remember(allArtifacts) { buildResultArtifactStats(allArtifacts) }
    val latestArtifact = remember(allArtifacts) { selectLatestResultArtifact(allArtifacts) }

    LaunchedEffect(selectedTaskId) {
        if (!selectedTaskId.isNullOrBlank()) {
            WorkflowFocusStore.setTaskFocus(TaskRefreshFocusKind.LATEST_SUMMARY, selectedTaskId)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.results_title))
                        Text(
                            text = stringResource(R.string.results_subtitle),
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
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                ResultCenterModeSwitcher(
                    activeMode = activeMode,
                    onModeChange = { activeModeName = it.name },
                )
            }

            if (activeMode == ResultCenterMode.SUMMARY) {
                item {
                    ResultSummaryOverviewCard(
                        summary = selectedSummary,
                        taskChatPreview = selectedTaskChatPreview,
                        onOpenTaskDetail = {
                            selectedSummary?.taskId?.let(onOpenTaskDetail)
                        },
                        onOpenFiles = { onOpenFiles(resultFileQuery, selectedTaskId) },
                        onOpenGit = { onOpenGit(resultGitTab, selectedTaskId) },
                        onOpenHome = onOpenHome,
                        onCopySummary = {
                            selectedSummary?.let { summary ->
                                clipboard.nativeClipboard.setPrimaryClip(
                                    ClipData.newPlainText(
                                        "result-summary",
                                        buildResultShareText(summary = summary, taskChatPreview = selectedTaskChatPreview),
                                    )
                                )
                                Toast.makeText(context, context.getString(R.string.common_copied), Toast.LENGTH_SHORT).show()
                            }
                        },
                        onShareSummary = {
                            selectedSummary?.let { summary ->
                                MessageExporter.share(
                                    context,
                                    buildResultShareText(summary = summary, taskChatPreview = selectedTaskChatPreview),
                                )
                            }
                        },
                        onFollowUp = {
                            selectedSummary?.let { summary ->
                                val sent = sendAgentCommand(context, buildResultFollowUpPrompt(summary))
                                val messageRes = if (sent) R.string.results_follow_up_sent else R.string.results_follow_up_failed
                                Toast.makeText(context, context.getString(messageRes), Toast.LENGTH_SHORT).show()
                            }
                        },
                    )
                }

                item {
                    ResultSavedArtifactsSection(
                        title = stringResource(R.string.results_section_saved_artifacts),
                        emptyMessage = stringResource(R.string.results_artifacts_empty),
                        artifacts = recentArtifacts,
                        onArtifactSavedStateChanged = { artifactVersion += 1 },
                        onOpenArtifactFiles = { artifact ->
                            val artifactTaskId = resolveResultArtifactTaskId(artifact, selectedTaskId)
                            onOpenFiles(buildResultArtifactFileQuery(artifact), artifactTaskId)
                        },
                        onOpenArtifactGit = { artifact ->
                            val artifactTaskId = resolveResultArtifactTaskId(artifact, selectedTaskId)
                            onOpenGit(ResultGitTab.STATUS.routeValue, artifactTaskId)
                        },
                        onOpenArtifactOrigin = { sessionId, taskId ->
                            onOpenArtifactOrigin(sessionId, taskId)
                        },
                        fallbackTaskId = selectedTaskId,
                    )
                }

                if (selection.summaries.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.results_section_recent),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    items(selection.summaries, key = { it.taskId }) { summary ->
                        ResultSummaryCard(
                            summary = summary,
                            selected = summary.taskId == selectedTaskId,
                            onClick = { activeTaskId = summary.taskId },
                        )
                    }
                }
            } else {
                item {
                    ResultArtifactStatsCard(
                        stats = artifactStats,
                        latestArtifact = latestArtifact,
                    )
                }
                item {
                    ResultArtifactSearchAndFilterCard(
                        searchQuery = artifactSearchQuery,
                        onSearchQueryChange = { artifactSearchQuery = it },
                        filterMode = artifactFilterMode,
                        onFilterModeChange = { artifactFilterModeName = it.name },
                    )
                }
                item {
                    ResultGroupedArtifactsSection(
                        title = stringResource(R.string.results_section_artifact_center),
                        emptyMessage = stringResource(
                            if (allArtifacts.isEmpty()) R.string.results_artifacts_empty else R.string.results_artifacts_filter_empty,
                        ),
                        sections = groupedArtifacts,
                        onArtifactSavedStateChanged = { artifactVersion += 1 },
                        onOpenArtifactFiles = { artifact ->
                            val artifactTaskId = resolveResultArtifactTaskId(artifact, selectedTaskId)
                            onOpenFiles(buildResultArtifactFileQuery(artifact), artifactTaskId)
                        },
                        onOpenArtifactGit = { artifact ->
                            val artifactTaskId = resolveResultArtifactTaskId(artifact, selectedTaskId)
                            onOpenGit(ResultGitTab.STATUS.routeValue, artifactTaskId)
                        },
                        onOpenArtifactOrigin = { sessionId, taskId ->
                            onOpenArtifactOrigin(sessionId, taskId)
                        },
                        fallbackTaskId = selectedTaskId,
                    )
                }
            }
        }
    }
}

@Composable
private fun ResultSummaryOverviewCard(
    summary: WorkflowTaskSummary?,
    taskChatPreview: TaskChatActivityEntry?,
    onOpenTaskDetail: () -> Unit,
    onOpenFiles: () -> Unit,
    onOpenGit: () -> Unit,
    onOpenHome: () -> Unit,
    onCopySummary: () -> Unit,
    onShareSummary: () -> Unit,
    onFollowUp: () -> Unit,
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
            Text(
                text = stringResource(R.string.results_section_current),
                style = MaterialTheme.typography.titleMedium,
            )
            if (summary == null) {
                Text(
                    text = stringResource(R.string.results_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenHome, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.empty_state_action_home))
                    }
                    OutlinedButton(onClick = onOpenFiles, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_open_files))
                    }
                }
            } else {
                ResultInfoRow(
                    label = stringResource(R.string.results_label_task_id),
                    value = summary.taskId,
                )
                ResultInfoRow(
                    label = stringResource(R.string.results_label_duration),
                    value = formatResultDuration(summary.durationMs),
                )
                ResultInfoRow(
                    label = stringResource(R.string.results_label_files_changed),
                    value = summary.filesChanged.toString(),
                )
                ResultInfoRow(
                    label = stringResource(R.string.results_label_total_tokens),
                    value = summary.totalTokens.toString(),
                )
                if (summary.gitStat.isNotBlank()) {
                    Text(
                        text = summary.gitStat,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                taskChatPreview?.let { preview ->
                    TaskChatPreviewSection(preview = preview)
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenTaskDetail, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_open_task))
                    }
                    OutlinedButton(onClick = onOpenFiles, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_open_files))
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenGit, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_open_git))
                    }
                    OutlinedButton(onClick = onFollowUp, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_follow_up))
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onCopySummary, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_copy_summary))
                    }
                    OutlinedButton(onClick = onShareSummary, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.results_action_share_summary))
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultSavedArtifactsSection(
    title: String,
    emptyMessage: String,
    artifacts: List<Artifact>,
    onArtifactSavedStateChanged: () -> Unit = {},
    onOpenArtifactFiles: ((Artifact) -> Unit)? = null,
    onOpenArtifactGit: ((Artifact) -> Unit)? = null,
    onOpenArtifactOrigin: ((String?, String?) -> Unit)? = null,
    fallbackTaskId: String? = null,
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
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
            )
            if (artifacts.isEmpty()) {
                Text(
                    text = emptyMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            } else {
                artifacts.forEach { artifact ->
                    ResultArtifactEntry(
                        artifact = artifact,
                        onArtifactSavedStateChanged = onArtifactSavedStateChanged,
                        onOpenArtifactFiles = onOpenArtifactFiles,
                        onOpenArtifactGit = onOpenArtifactGit,
                        onOpenArtifactOrigin = onOpenArtifactOrigin,
                        fallbackTaskId = fallbackTaskId,
                    )
                }
            }
        }
    }
}

@Composable
private fun ResultGroupedArtifactsSection(
    title: String,
    emptyMessage: String,
    sections: List<ResultArtifactSection>,
    onArtifactSavedStateChanged: () -> Unit = {},
    onOpenArtifactFiles: ((Artifact) -> Unit)? = null,
    onOpenArtifactGit: ((Artifact) -> Unit)? = null,
    onOpenArtifactOrigin: ((String?, String?) -> Unit)? = null,
    fallbackTaskId: String? = null,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
            )
            if (sections.isEmpty()) {
                Text(
                    text = emptyMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            } else {
                sections.forEach { section ->
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            text = "${resultArtifactFilterLabel(section.filterMode)} ? ${section.artifacts.size}",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        section.artifacts.forEach { artifact ->
                            ResultArtifactEntry(
                                artifact = artifact,
                                onArtifactSavedStateChanged = onArtifactSavedStateChanged,
                                onOpenArtifactFiles = onOpenArtifactFiles,
                                onOpenArtifactGit = onOpenArtifactGit,
                                onOpenArtifactOrigin = onOpenArtifactOrigin,
                                fallbackTaskId = fallbackTaskId,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultArtifactEntry(
    artifact: Artifact,
    onArtifactSavedStateChanged: () -> Unit,
    onOpenArtifactFiles: ((Artifact) -> Unit)? = null,
    onOpenArtifactGit: ((Artifact) -> Unit)? = null,
    onOpenArtifactOrigin: ((String?, String?) -> Unit)? = null,
    fallbackTaskId: String? = null,
) {
    val originSummary = buildResultArtifactOriginSummary(artifact)
    val originTarget = resolveResultArtifactOriginTarget(artifact, fallbackTaskId = fallbackTaskId)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = resolveResultArtifactTitle(artifact),
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = resolveResultArtifactTypeLabel(artifact),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        if (!originSummary.isNullOrBlank()) {
            Text(
                text = "${stringResource(R.string.results_artifact_origin_label)}: $originSummary",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
        ArtifactCard(
            code = artifact.content,
            lang = artifact.lang,
            type = artifact.type,
            artifactIdOverride = artifact.id,
            title = artifact.title,
            shareText = buildArtifactShareText(artifact),
            taskId = artifact.taskId,
            sessionId = artifact.sessionId,
            sourceHint = artifact.sourceHint,
            onSavedStateChanged = { onArtifactSavedStateChanged() },
        )
        if (onOpenArtifactFiles != null || onOpenArtifactGit != null || (onOpenArtifactOrigin != null && originTarget != null)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (onOpenArtifactFiles != null) {
                    OutlinedButton(
                        onClick = { onOpenArtifactFiles(artifact) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.results_action_open_files))
                    }
                }
                if (onOpenArtifactGit != null) {
                    OutlinedButton(
                        onClick = { onOpenArtifactGit(artifact) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.results_action_open_git))
                    }
                }
                if (onOpenArtifactOrigin != null && originTarget != null) {
                    OutlinedButton(
                        onClick = { onOpenArtifactOrigin(originTarget.sessionId, originTarget.taskId) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.results_action_open_origin))
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultCenterModeSwitcher(
    activeMode: ResultCenterMode,
    onModeChange: (ResultCenterMode) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ResultCenterMode.entries.forEach { mode ->
                FilterChip(
                    selected = mode == activeMode,
                    onClick = { onModeChange(mode) },
                    label = {
                        Text(
                            text = when (mode) {
                                ResultCenterMode.SUMMARY -> stringResource(R.string.results_mode_summary)
                                ResultCenterMode.ARTIFACTS -> stringResource(R.string.results_mode_artifacts)
                            }
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun ResultArtifactStatsCard(
    stats: ResultArtifactStats,
    latestArtifact: Artifact?,
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
            Text(
                text = stringResource(R.string.results_section_artifact_center),
                style = MaterialTheme.typography.titleMedium,
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_total),
                value = stats.totalCount.toString(),
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_code),
                value = stats.codeCount.toString(),
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_html),
                value = stats.htmlCount.toString(),
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_svg),
                value = stats.svgCount.toString(),
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_mermaid),
                value = stats.mermaidCount.toString(),
            )
            ResultInfoRow(
                label = stringResource(R.string.results_artifact_visual),
                value = stats.visualCount.toString(),
            )
            latestArtifact?.let { artifact ->
                ResultInfoRow(
                    label = stringResource(R.string.results_artifact_latest_saved),
                    value = resolveResultArtifactTitle(artifact),
                )
            }
        }
    }
}

@Composable
private fun ResultArtifactSearchAndFilterCard(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    filterMode: ResultArtifactFilterMode,
    onFilterModeChange: (ResultArtifactFilterMode) -> Unit,
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
            OutlinedTextField(
                value = searchQuery,
                onValueChange = onSearchQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text(stringResource(R.string.results_artifact_search_placeholder)) },
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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ResultArtifactFilterMode.entries.forEach { mode ->
                    FilterChip(
                        selected = mode == filterMode,
                        onClick = { onFilterModeChange(mode) },
                        label = { Text(resultArtifactFilterLabel(mode)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun resultArtifactFilterLabel(mode: ResultArtifactFilterMode): String {
    return when (mode) {
        ResultArtifactFilterMode.ALL -> stringResource(R.string.results_artifact_filter_all)
        ResultArtifactFilterMode.CODE -> stringResource(R.string.results_artifact_filter_code)
        ResultArtifactFilterMode.HTML -> stringResource(R.string.results_artifact_filter_html)
        ResultArtifactFilterMode.SVG -> stringResource(R.string.results_artifact_filter_svg)
        ResultArtifactFilterMode.MERMAID -> stringResource(R.string.results_artifact_filter_mermaid)
    }
}

@Composable
private fun ResultSummaryCard(
    summary: WorkflowTaskSummary,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val containerColor by animateColorAsState(
        targetValue = if (selected) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "resultSummaryCardContainer",
    )
    val borderColor by animateColorAsState(
        targetValue = if (selected) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
        } else {
            Color.Transparent
        },
        label = "resultSummaryCardBorder",
    )
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = summary.taskId,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = stringResource(
                    R.string.results_summary_metrics,
                    formatResultDuration(summary.durationMs),
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
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ResultInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun formatResultDuration(durationMs: Long): String {
    if (durationMs <= 0L) return "0ms"
    return if (durationMs < 1000L) {
        "${durationMs}ms"
    } else {
        String.format("%.1fs", durationMs / 1000f)
    }
}


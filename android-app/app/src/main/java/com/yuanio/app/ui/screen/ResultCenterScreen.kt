package com.yuanio.app.ui.screen

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yuanio.app.R
import com.yuanio.app.data.WorkflowSnapshotStore
import com.yuanio.app.data.WorkflowTaskSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultCenterScreen(
    onBack: () -> Unit,
    onOpenTaskDetail: (String) -> Unit,
    onOpenFiles: () -> Unit,
    onOpenGit: () -> Unit,
    onOpenHome: () -> Unit,
    requestedTaskId: String? = null,
) {
    val snapshot by WorkflowSnapshotStore.snapshot.collectAsStateWithLifecycle()
    var activeTaskId by remember(requestedTaskId) { mutableStateOf(requestedTaskId?.trim().orEmpty()) }
    val selection = resolveResultSummarySelection(activeTaskId, snapshot)
    val selectedSummary = selection.selectedSummary
    val selectedTaskId = selectedSummary?.taskId

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
                ResultSummaryOverviewCard(
                    summary = selectedSummary,
                    onOpenTaskDetail = {
                        selectedSummary?.taskId?.let(onOpenTaskDetail)
                    },
                    onOpenFiles = onOpenFiles,
                    onOpenGit = onOpenGit,
                    onOpenHome = onOpenHome,
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
        }
    }
}

@Composable
private fun ResultSummaryOverviewCard(
    summary: WorkflowTaskSummary?,
    onOpenTaskDetail: () -> Unit,
    onOpenFiles: () -> Unit,
    onOpenGit: () -> Unit,
    onOpenHome: () -> Unit,
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
                OutlinedButton(onClick = onOpenGit, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.results_action_open_git))
                }
            }
        }
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

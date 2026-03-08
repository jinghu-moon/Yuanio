package com.yuanio.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.yuanio.app.R

@Composable
fun MiniChatPane(
    uiState: ChatViewModel.ChatUiState,
    turnState: ChatViewModel.TurnState,
    sessionControl: ChatViewModel.SessionControlState,
    foregroundProbe: ChatViewModel.ForegroundProbeState,
    pendingApprovalCount: Int,
    safeApprovalCount: Int,
    diffPaths: List<String>,
    timelinePreview: List<String>,
    terminalPreview: List<String>,
    onOpenQueue: () -> Unit,
    onOpenTimeline: () -> Unit,
    onNavigateTerminal: () -> Unit,
    onNavigateFiles: () -> Unit,
    onProbe: () -> Unit,
    onCompact: () -> Unit,
    onToggleMemory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxHeight(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f),
    ) {
        Column(
            modifier = Modifier
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            MiniPaneSection(title = "Overview") {
                Text(
                    text = "${uiState.agentState.agent} ? ${uiState.connState.name.lowercase()} ? ${uiState.connectionType}",
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = stringResource(
                        R.string.chat_runtime_tasks_approvals,
                        turnState.runningTasks,
                        turnState.pendingApprovals,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "Context ${sessionControl.contextUsedPercentage}% ? ${sessionControl.contextTokens}/${sessionControl.contextWindowSize}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "Probe ${foregroundProbe.status} ? RTT ${foregroundProbe.latencyMs ?: 0}ms",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (uiState.agentState.runningTasks.isNotEmpty()) {
                MiniPaneSection(title = "Tasks") {
                    uiState.agentState.runningTasks.take(5).forEach { task ->
                        MiniPaneTag(text = "${task.taskId} ? ${task.agent}")
                    }
                }
            }

            if (pendingApprovalCount > 0 || diffPaths.isNotEmpty()) {
                MiniPaneSection(title = "Review") {
                    Text(
                        text = "Pending approvals: $pendingApprovalCount ? Low-risk: $safeApprovalCount",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    diffPaths.take(5).forEach { path ->
                        MiniPaneTag(text = path)
                    }
                }
            }

            if (timelinePreview.isNotEmpty()) {
                MiniPaneSection(title = stringResource(R.string.chat_timeline_title)) {
                    timelinePreview.take(5).forEach { entry ->
                        Text(
                            text = entry,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (terminalPreview.isNotEmpty()) {
                MiniPaneSection(title = "Terminal tail") {
                    terminalPreview.takeLast(8).forEach { line ->
                        Text(
                            text = line,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            MiniPaneSection(title = "Actions") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenQueue, enabled = pendingApprovalCount > 0, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_open_queue))
                    }
                    OutlinedButton(onClick = onOpenTimeline, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_topbar_menu_timeline))
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onNavigateFiles, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_topbar_menu_files))
                    }
                    OutlinedButton(onClick = onNavigateTerminal, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_topbar_menu_terminal))
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onProbe, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_action_probe))
                    }
                    OutlinedButton(onClick = onCompact, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_action_compact))
                    }
                }
                OutlinedButton(onClick = onToggleMemory, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (sessionControl.memoryEnabled) {
                            stringResource(R.string.chat_memory_disable)
                        } else {
                            stringResource(R.string.chat_memory_enable)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun MiniPaneSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.65f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                content()
            }
        }
    }
}

@Composable
private fun MiniPaneTag(text: String) {
    AssistChip(
        onClick = {},
        label = {
            Text(
                text = text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    )
}

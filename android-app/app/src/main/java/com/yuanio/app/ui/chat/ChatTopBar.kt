package com.yuanio.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.ModelMode
import com.yuanio.app.data.PermissionMode
import com.yuanio.app.ui.component.ActionGlyph
import com.yuanio.app.ui.component.ActionGlyphIcon
import com.yuanio.app.ui.component.BrandIcon
import com.yuanio.app.ui.component.agentToBrand
import com.yuanio.app.ui.screen.ChatViewModel
import com.yuanio.app.ui.theme.LocalYuanioColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTopBar(
    agentState: ChatViewModel.AgentHeartbeat,
    connState: ConnectionState,
    devices: List<ChatViewModel.ConnectedDevice>,
    shellMode: Boolean,
    contextPercentage: Int,
    searchActive: Boolean,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onToggleSearch: () -> Unit,
    onNewSession: () -> Unit,
    onExport: () -> Unit,
    onNavigateSessions: () -> Unit,
    onNavigateFiles: () -> Unit,
    onNavigateTerminal: () -> Unit,
    onOpenTimeline: () -> Unit,
) {
    val vibeCastColors = LocalYuanioColors.current
    var moreMenuExpanded by remember { mutableStateOf(false) }
    val projectName = agentState.projectPath
        ?.substringAfterLast('/')
        ?.substringAfterLast('\\')
        ?.takeIf { it.isNotBlank() }
        ?: stringResource(R.string.app_name)
    val brand = agentToBrand(agentState.agent)

    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (brand != null) {
                        BrandIcon(
                            brand = brand,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        projectName,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.width(8.dp))
                    val connColor: Color = when (connState) {
                        ConnectionState.CONNECTED -> vibeCastColors.connected
                        ConnectionState.RECONNECTING -> vibeCastColors.reconnecting
                        ConnectionState.DISCONNECTED -> vibeCastColors.disconnected
                    }
                    val connBg = when (connState) {
                        ConnectionState.CONNECTED -> vibeCastColors.connected.copy(alpha = 0.16f)
                        ConnectionState.RECONNECTING -> vibeCastColors.reconnecting.copy(alpha = 0.16f)
                        ConnectionState.DISCONNECTED -> vibeCastColors.disconnected.copy(alpha = 0.16f)
                    }
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(connBg),
                        contentAlignment = Alignment.Center
                    ) {
                        val pulseAlpha = if (connState == ConnectionState.RECONNECTING) {
                            val pulse = rememberInfiniteTransition(label = "connPulse")
                            pulse.animateFloat(
                                initialValue = 0.4f,
                                targetValue = 1f,
                                animationSpec = infiniteRepeatable(
                                    animation = tween(900),
                                    repeatMode = RepeatMode.Reverse
                                ),
                                label = "connPulseAlpha"
                            ).value
                        } else 1f
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .alpha(pulseAlpha)
                                .clip(CircleShape)
                                .background(connColor)
                        )
                    }
                    if (devices.size > 1) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "x${devices.size}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                }
                Text(
                    text = buildSubtitle(agentState, shellMode),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                if (contextPercentage > 0) {
                    Spacer(Modifier.width(6.dp))
                    // Context 使用百分比指示器
                    val ctxColor = when {
                        contextPercentage >= 80 -> MaterialTheme.colorScheme.error
                        contextPercentage >= 50 -> MaterialTheme.colorScheme.tertiary
                        else -> MaterialTheme.colorScheme.outline
                    }
                    Text(
                        text = "Ctx $contextPercentage%",
                        style = MaterialTheme.typography.labelSmall,
                        color = ctxColor,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }

            val taskCount = agentState.runningTasks.size
            val statusLabel = when (agentState.status) {
                "running" -> {
                    if (taskCount > 1) {
                        stringResource(R.string.chat_topbar_status_running_count, taskCount)
                    } else {
                        stringResource(R.string.chat_topbar_status_running)
                    }
                }
                "waiting_approval" -> stringResource(R.string.chat_topbar_status_waiting_approval)
                "error" -> stringResource(R.string.chat_topbar_status_error)
                "idle" -> stringResource(R.string.chat_topbar_status_idle)
                else -> ""
            }
            if (agentState.lastSeen > 0 && statusLabel.isNotBlank()) {
                val statusColor = when (agentState.status) {
                    "running" -> MaterialTheme.colorScheme.primary
                    "waiting_approval" -> MaterialTheme.colorScheme.tertiary
                    "error" -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.outline
                }
                val statusBg = when (agentState.status) {
                    "running" -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                    "waiting_approval" -> MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.45f)
                    "error" -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.55f)
                    else -> MaterialTheme.colorScheme.surfaceVariant
                }
                Text(
                    text = statusLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(statusBg)
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                )
                Spacer(Modifier.width(6.dp))
            }

            IconButton(onClick = onNewSession) {
                ActionGlyphIcon(
                    glyph = ActionGlyph.PLUS,
                    contentDescription = stringResource(R.string.chat_topbar_cd_new_session),
                    iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Box {
                IconButton(onClick = { moreMenuExpanded = true }) {
                    ActionGlyphIcon(
                        glyph = ActionGlyph.MORE_VERTICAL,
                        contentDescription = stringResource(R.string.chat_topbar_cd_more_actions),
                        iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                DropdownMenu(
                    expanded = moreMenuExpanded,
                    onDismissRequest = { moreMenuExpanded = false }
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_topbar_menu_terminal)) },
                        onClick = {
                            moreMenuExpanded = false
                            onNavigateTerminal()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_topbar_menu_files)) },
                        onClick = {
                            moreMenuExpanded = false
                            onNavigateFiles()
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (searchActive) {
                                    stringResource(R.string.chat_topbar_menu_close_search)
                                } else {
                                    stringResource(R.string.chat_topbar_menu_search)
                                }
                            )
                        },
                        onClick = {
                            moreMenuExpanded = false
                            onToggleSearch()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_topbar_menu_timeline)) },
                        onClick = {
                            moreMenuExpanded = false
                            onOpenTimeline()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_topbar_menu_export)) },
                        onClick = {
                            moreMenuExpanded = false
                            onExport()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_topbar_menu_sessions)) },
                        onClick = {
                            moreMenuExpanded = false
                            onNavigateSessions()
                        }
                    )
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))

        AnimatedVisibility(
            visible = searchActive,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut()
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = onSearchQueryChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                placeholder = { Text(stringResource(R.string.chat_topbar_search_placeholder)) },
                singleLine = true,
                trailingIcon = {
                    if (searchQuery.isNotBlank()) {
                        IconButton(onClick = { onSearchQueryChange("") }) {
                            ActionGlyphIcon(
                                glyph = ActionGlyph.X,
                                contentDescription = stringResource(R.string.chat_topbar_cd_clear_search),
                            )
                        }
                    }
                }
            )
        }
    }
}

@Composable
private fun buildSubtitle(
    agentState: ChatViewModel.AgentHeartbeat,
    shellMode: Boolean,
): String {
    if (shellMode) return stringResource(R.string.chat_topbar_subtitle_shell_offline)
    val workspaceText = stringResource(R.string.chat_topbar_subtitle_workspace)
    val projectName = agentState.projectPath
        ?.substringAfterLast('/')
        ?.substringAfterLast('\\')
        ?.takeIf { it.isNotBlank() }
        ?: workspaceText
    return buildString {
        append(workspaceText)
        append(" / ")
        append(projectName)
        if (agentState.modelMode != ModelMode.DEFAULT) {
            append(" · ${stringResource(agentState.modelMode.labelRes)}")
        }
        if (agentState.permissionMode != PermissionMode.DEFAULT) {
            append(" · ${stringResource(agentState.permissionMode.labelRes)}")
        }
        if (agentState.agent.isNotBlank()) {
            append(" · ${agentState.agent.uppercase()}")
        }
    }
}

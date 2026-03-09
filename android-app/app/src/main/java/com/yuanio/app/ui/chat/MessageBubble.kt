package com.yuanio.app.ui.chat

import android.content.ClipData
import android.text.format.DateFormat
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.rememberScrollState
import com.yuanio.app.R
import com.yuanio.app.ui.component.BrandIcon
import com.yuanio.app.ui.component.MarkdownText
import com.yuanio.app.ui.component.MessageContextMenu
import com.yuanio.app.ui.component.MessageContextMenuAction
import com.yuanio.app.ui.component.agentColor
import com.yuanio.app.ui.component.agentToBrand
import com.yuanio.app.ui.model.ChatItem
import com.yuanio.app.ui.model.DeliveryStatus
import com.yuanio.app.ui.theme.LocalYuanioColors

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    msg: ChatItem.Text,
    isStreaming: Boolean = false,
    searchQuery: String = "",
    isSpeaking: Boolean = false,
    onRetry: () -> Unit = {},
    onFork: () -> Unit = {},
    onEdit: () -> Unit = {},
    onUndoSend: () -> Unit = {},
    canEdit: Boolean = false,
    canUndoSend: Boolean = false,
    onSpeak: () -> Unit = {},
    onStopSpeaking: () -> Unit = {},
    onTaskClick: (String) -> Unit = {},
    relativeTimeTick: Long = System.currentTimeMillis(),
) {
    val isUser = msg.role == "user"
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val copyText = stringResource(R.string.common_copy)
    val copiedText = stringResource(R.string.common_copied)
    val editText = stringResource(R.string.common_edit)
    val undoSendText = stringResource(R.string.message_action_undo_send)
    val editedLabel = stringResource(R.string.message_edited)
    val forkHereText = stringResource(R.string.message_action_fork_here)
    val sendFailedRetryText = stringResource(R.string.message_send_failed_retry)
    val cdStopRead = stringResource(R.string.tts_stop_reading)
    val cdRead = stringResource(R.string.tts_read_aloud)
    var showMenu by remember { mutableStateOf(false) }
    val relativeTime = formatRelativeTime(msg.ts, relativeTimeTick)
    val taskIds = remember(msg.content) { extractTaskIds(msg.content) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(
            Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(
                    when {
                        msg.failed -> MaterialTheme.colorScheme.errorContainer
                        isUser -> MaterialTheme.colorScheme.surfaceContainerHighest
                        else -> androidx.compose.ui.graphics.Color.Transparent
                    }
                )
                .combinedClickable(onClick = {}, onLongClick = { showMenu = true })
                .padding(12.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!isUser && !msg.agent.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val brand = agentToBrand(msg.agent)
                        if (brand != null) {
                            BrandIcon(
                                brand = brand,
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                        }
                        Text(
                            msg.agent.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = agentColor(msg.agent)
                        )
                    }
                }
                if (searchQuery.isNotBlank()) {
                    HighlightedText(text = msg.content, query = searchQuery)
                } else if (isUser || isStreaming) {
                    Text(
                        msg.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                } else {
                    MarkdownText(msg.content)
                }
                if (!isUser && taskIds.isNotEmpty()) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        taskIds.take(4).forEach { taskId ->
                            TextButton(onClick = { onTaskClick(taskId) }) {
                                Text(stringResource(R.string.message_action_view_task, taskId))
                            }
                        }
                    }
                }
                if (isUser && msg.editedCount > 0) {
                    Text(
                        editedLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            MessageContextMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false },
                actions = listOf(
                    MessageContextMenuAction(copyText) {
                        clipboard.nativeClipboard.setPrimaryClip(ClipData.newPlainText("message", msg.content))
                        Toast.makeText(context, copiedText, Toast.LENGTH_SHORT).show()
                    },
                    MessageContextMenuAction(forkHereText) { onFork() },
                    MessageContextMenuAction(editText, enabled = isUser && canEdit) { onEdit() },
                    MessageContextMenuAction(undoSendText, enabled = isUser && canUndoSend) { onUndoSend() },
                )
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                relativeTime,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(horizontal = 4.dp)
            )
            if (isUser && msg.delivery != null) {
                Spacer(Modifier.width(2.dp))
                Text(
                    when (msg.delivery) {
                        DeliveryStatus.SENDING -> "✓"
                        DeliveryStatus.DELIVERED -> "✓✓"
                        DeliveryStatus.READ -> "✓✓"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = if (msg.delivery == DeliveryStatus.READ) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.outline
                    },
                )
            }
            if (msg.failed) {
                Spacer(Modifier.width(4.dp))
                TextButton(onClick = onRetry) {
                    Text(sendFailedRetryText, color = MaterialTheme.colorScheme.error)
                }
            }
            if (!isUser) {
                IconButton(
                    onClick = { if (isSpeaking) onStopSpeaking() else onSpeak() },
                    modifier = Modifier.size(24.dp)
                ) {
                    Icon(
                        painter = painterResource(
                            if (isSpeaking) R.drawable.ic_tb_player_stop else R.drawable.ic_tb_volume
                        ),
                        contentDescription = if (isSpeaking) cdStopRead else cdRead,
                        modifier = Modifier.size(14.dp),
                        tint = if (isSpeaking) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
                    )
                }
            }
        }
    }
}

private fun extractTaskIds(content: String): List<String> {
    val ids = linkedSetOf<String>()
    Regex("""(?m)^\s*-\s*([a-zA-Z0-9._:-]{6,})\s+·""")
        .findAll(content)
        .forEach { ids.add(it.groupValues[1]) }
    Regex("""/task\s+([a-zA-Z0-9._:-]{6,})""")
        .findAll(content)
        .forEach { ids.add(it.groupValues[1]) }
    return ids.toList()
}

@Composable
private fun HighlightedText(text: String, query: String) {
    val warning = LocalYuanioColors.current.warning
    if (query.isBlank()) {
        Text(text, style = MaterialTheme.typography.bodyMedium)
        return
    }
    val lowerText = text.lowercase()
    val lowerQuery = query.lowercase()
    val annotated = buildAnnotatedString {
        var start = 0
        while (start < text.length) {
            val idx = lowerText.indexOf(lowerQuery, start)
            if (idx < 0) {
                append(text.substring(start))
                break
            }
            append(text.substring(start, idx))
            withStyle(SpanStyle(background = warning.copy(alpha = 0.24f))) {
                append(text.substring(idx, idx + query.length))
            }
            start = idx + query.length
        }
    }
    Text(annotated, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun formatRelativeTime(ts: Long, nowMs: Long): String {
    val deltaSec = ((nowMs - ts) / 1000L).coerceAtLeast(0L)
    return when {
        deltaSec < 60 -> stringResource(R.string.time_just_now)
        deltaSec < 3600 -> stringResource(R.string.time_minutes_ago, deltaSec / 60)
        deltaSec < 24 * 3600 -> DateFormat.format("HH:mm", ts).toString()
        else -> DateFormat.format("MM-dd HH:mm", ts).toString()
    }
}

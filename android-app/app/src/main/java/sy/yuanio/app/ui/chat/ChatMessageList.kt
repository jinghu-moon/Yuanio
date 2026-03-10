package sy.yuanio.app.ui.chat

import android.text.format.DateFormat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R
import sy.yuanio.app.ui.component.ActionGlyph
import sy.yuanio.app.ui.component.ActionGlyphIcon
import sy.yuanio.app.ui.component.ApprovalCard
import sy.yuanio.app.ui.component.DiffView
import sy.yuanio.app.ui.component.ThinkingBlock
import sy.yuanio.app.ui.component.TokenCountBadge
import sy.yuanio.app.ui.component.TodoCard
import sy.yuanio.app.ui.component.ToolCallCard
import sy.yuanio.app.ui.model.ChatItem
import sy.yuanio.app.ui.model.ToolCallStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

data class MessageListCallbacks(
    val onSuggestionClick: (String) -> Unit,
    val onRetry: (ChatItem.Text) -> Unit,
    val onFork: (Int) -> Unit,
    val onEdit: (ChatItem.Text) -> Unit,
    val onUndoSend: (ChatItem.Text) -> Unit,
    val canEdit: (ChatItem.Text) -> Boolean,
    val canUndoSend: (ChatItem.Text) -> Boolean,
    val onSpeak: (String, Int) -> Unit,
    val onStopSpeaking: () -> Unit,
    val onTaskClick: (String) -> Unit,
    val onApprove: (String) -> Unit,
    val onReject: (String) -> Unit,
)

@Composable
fun ChatMessageList(
    items: List<ChatItem>,
    streaming: Boolean,
    waiting: Boolean,
    callbacks: MessageListCallbacks,
    speakingIndex: Int,
    searchActive: Boolean,
    searchQuery: String,
    modifier: Modifier = Modifier,
    scrollToIndex: Int? = null,
    onScrollToIndexHandled: () -> Unit = {},
    artifactSessionId: String? = null,
    preferredArtifactTaskId: String? = null,
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val expandedMap = remember { mutableStateMapOf<Int, Boolean>() }
    var lastVisibleIndex by remember { mutableIntStateOf(items.lastIndex) }
    var previousItemCount by remember { mutableIntStateOf(items.size) }
    var unreadCount by remember { mutableIntStateOf(0) }
    val isAtBottom by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            last == null || last.index >= listState.layoutInfo.totalItemsCount - 2
        }
    }
    val relativeTimeTick by produceState(initialValue = System.currentTimeMillis()) {
        while (true) {
            delay(30_000L)
            value = System.currentTimeMillis()
        }
    }
    val displayGroups = remember(items) { buildToolCallGroups(items) }

    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { lastVisibleIndex = it }
    }
    LaunchedEffect(isAtBottom) {
        if (isAtBottom) unreadCount = 0
    }
    LaunchedEffect(items.size) {
        val newCount = items.size
        val oldCount = previousItemCount
        when {
            newCount <= 0 -> {
                previousItemCount = 0
                unreadCount = 0
            }
            newCount < oldCount -> {
                previousItemCount = newCount
                unreadCount = unreadCount.coerceAtMost(newCount)
            }
            shouldAutoScrollToBottom(
                previousTotalItems = oldCount,
                lastVisibleIndex = lastVisibleIndex,
                newTotalItems = newCount,
            ) -> {
                listState.animateScrollToItem(newCount - 1)
                previousItemCount = newCount
                unreadCount = 0
            }
            else -> {
                unreadCount = accumulateUnreadMessageCount(
                    previousTotalItems = oldCount,
                    newTotalItems = newCount,
                    lastVisibleIndex = lastVisibleIndex,
                    previousUnreadCount = unreadCount,
                )
                previousItemCount = newCount
            }
        }
    }
    LaunchedEffect(scrollToIndex, items.size) {
        val target = scrollToIndex ?: return@LaunchedEffect
        if (items.isEmpty()) {
            onScrollToIndexHandled()
            return@LaunchedEffect
        }
        val clamped = target.coerceIn(0, items.lastIndex)
        listState.animateScrollToItem(clamped)
        onScrollToIndexHandled()
    }

    Box(modifier = modifier.fillMaxSize()) {
        if (items.isEmpty() && waiting) {
            MessageSkeleton(Modifier.fillMaxSize())
        } else if (items.isEmpty() && !streaming && !waiting) {
            ChatEmptyState(
                onSuggestionClick = callbacks.onSuggestionClick,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                displayGroups.forEachIndexed { groupIndex, group ->
                    val currentTs = group.firstTimestamp()
                    val previousTs = displayGroups.getOrNull(groupIndex - 1)?.lastTimestamp()
                    if (shouldShowTimeSeparator(previousTs, currentTs)) {
                        item(key = "sep:${group.stableGroupKey()}", contentType = "time_separator") {
                            TimeSeparator(currentTs!!)
                        }
                    }
                    when (group) {
                        is DisplayGroup.Single -> {
                            item(key = group.item.stableKey, contentType = chatItemContentType(group.item)) {
                                ChatItemView(
                                    item = group.item,
                                    index = group.index,
                                    callbacks = callbacks,
                                    speakingIndex = speakingIndex,
                                    streaming = streaming,
                                    isLastItem = group.index == items.lastIndex,
                                    searchActive = searchActive,
                                    searchQuery = searchQuery,
                                    relativeTimeTick = relativeTimeTick,
                                    artifactSessionId = artifactSessionId,
                                    preferredArtifactTaskId = preferredArtifactTaskId,
                                )
                            }
                        }
                        is DisplayGroup.ToolCallGroup -> {
                            item(key = group.stableGroupKey(), contentType = "tool_call_group") {
                                ToolCallGroupView(
                                    items = group.items,
                                    startIndex = group.startIndex,
                                    expandedMap = expandedMap
                                )
                            }
                        }
                    }
                }
                if (waiting && !streaming) item(key = "typing", contentType = "typing") { TypingIndicator() }
                if (streaming) item(key = "streaming", contentType = "streaming") {
                    androidx.compose.material3.LinearProgressIndicator(
                        Modifier.fillMaxWidth().padding(top = 4.dp)
                    )
                }
            }
        }

        if (!isAtBottom && items.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(12.dp)
            ) {
                SmallFloatingActionButton(
                    onClick = {
                        scope.launch {
                            listState.animateScrollToItem(items.lastIndex)
                            unreadCount = 0
                        }
                    },
                ) {
                    ActionGlyphIcon(
                        glyph = ActionGlyph.CHEVRON_DOWN,
                        contentDescription = stringResource(R.string.chat_message_cd_scroll_bottom),
                    )
                }
                if (unreadCount > 0) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                        shape = CircleShape,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = 8.dp, y = (-8).dp),
                    ) {
                        Text(
                            text = unreadCount.coerceAtMost(99).toString(),
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatItemView(
    item: ChatItem,
    index: Int,
    callbacks: MessageListCallbacks,
    speakingIndex: Int,
    streaming: Boolean,
    isLastItem: Boolean,
    searchActive: Boolean,
    searchQuery: String,
    relativeTimeTick: Long,
    artifactSessionId: String? = null,
    preferredArtifactTaskId: String? = null,
) {
    var entered by rememberSaveable(item.stableKey) { mutableStateOf(false) }

    LaunchedEffect(item.stableKey) {
        entered = true
    }

    AnimatedVisibility(
        visible = entered,
        enter = fadeIn(animationSpec = tween(180)) +
            slideInVertically(
                animationSpec = tween(220),
                initialOffsetY = { fullHeight -> fullHeight / 6 },
            ),
    ) {
        Box(modifier = Modifier.fillMaxWidth().animateContentSize()) {
            when (item) {
                is ChatItem.Text -> MessageBubble(
                    msg = item,
                    isStreaming = streaming && isLastItem && item.role == "ai",
                    searchQuery = if (searchActive) searchQuery else "",
                    isSpeaking = speakingIndex == index,
                    onRetry = { callbacks.onRetry(item) },
                    onFork = { callbacks.onFork(index) },
                    onEdit = { callbacks.onEdit(item) },
                    onUndoSend = { callbacks.onUndoSend(item) },
                    canEdit = callbacks.canEdit(item),
                    canUndoSend = callbacks.canUndoSend(item),
                    onSpeak = { callbacks.onSpeak(item.content, index) },
                    onStopSpeaking = callbacks.onStopSpeaking,
                    onTaskClick = callbacks.onTaskClick,
                    artifactSessionId = artifactSessionId,
                    preferredArtifactTaskId = preferredArtifactTaskId,
                    relativeTimeTick = relativeTimeTick
                )
                is ChatItem.ToolCall -> ToolCallCard(
                    tool = item.tool,
                    status = item.status,
                    result = item.result,
                    summary = item.summary,
                    agent = item.agent
                )
                is ChatItem.Thinking -> ThinkingBlock(
                    content = item.content,
                    agent = item.agent,
                )
                is ChatItem.UsageInfo -> TokenCountBadge(totalTokens = item.totalTokens)
                is ChatItem.FileDiff -> DiffView(item.path, item.diff, item.action)
                is ChatItem.HookEvent -> HookEventChip(item)
                is ChatItem.Approval -> ApprovalCard(
                    approval = item,
                    onApprove = { callbacks.onApprove(item.id) },
                    onReject = { callbacks.onReject(item.id) }
                )
                is ChatItem.TodoUpdate -> TodoCard(todos = item.todos, taskId = item.taskId, agent = item.agent)
            }
        }
    }
}

@Composable
private fun HookEventChip(item: ChatItem.HookEvent) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        ActionGlyphIcon(
            glyph = ActionGlyph.BOLT,
            contentDescription = stringResource(R.string.chat_message_cd_event),
            modifier = Modifier.size(14.dp),
            iconTint = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.size(4.dp))
        Text(
            text = buildString {
                append(item.hook)
                item.tool?.let { append(" 路 $it") }
                if (item.event.isNotBlank()) append(": ${item.event}")
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun TypingIndicator() {
    val transition = rememberInfiniteTransition(label = "typing")
    val dots = (0..2).map { index ->
        transition.animateFloat(
            initialValue = 0f,
            targetValue = -6f,
            animationSpec = infiniteRepeatable(
                animation = tween(400, delayMillis = index * 150),
                repeatMode = RepeatMode.Reverse
            ),
            label = "dot_$index"
        )
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        dots.forEach {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .offset { IntOffset(0, it.value.dp.roundToPx()) }
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
            )
        }
    }
}

private sealed class DisplayGroup {
    data class Single(val item: ChatItem, val index: Int) : DisplayGroup()
    data class ToolCallGroup(val items: List<ChatItem.ToolCall>, val startIndex: Int) : DisplayGroup()
}

private fun buildToolCallGroups(items: List<ChatItem>): List<DisplayGroup> {
    val groups = mutableListOf<DisplayGroup>()
    var i = 0
    while (i < items.size) {
        if (items[i] is ChatItem.ToolCall) {
            val start = i
            val toolCalls = mutableListOf<ChatItem.ToolCall>()
            while (i < items.size && items[i] is ChatItem.ToolCall) {
                toolCalls.add(items[i] as ChatItem.ToolCall)
                i++
            }
            if (toolCalls.size >= 2) groups.add(DisplayGroup.ToolCallGroup(toolCalls, start))
            else groups.add(DisplayGroup.Single(toolCalls.first(), start))
        } else {
            groups.add(DisplayGroup.Single(items[i], i))
            i++
        }
    }
    return groups
}

private fun DisplayGroup.stableGroupKey(): String = when (this) {
    is DisplayGroup.Single -> item.stableKey
    is DisplayGroup.ToolCallGroup -> buildString {
        append("tool_group:")
        items.forEachIndexed { index, item ->
            if (index > 0) append('|')
            append(item.stableKey)
        }
    }
}

private fun chatItemContentType(item: ChatItem): String = when (item) {
    is ChatItem.Text -> "text:${item.role}"
    is ChatItem.Thinking -> "thinking"
    is ChatItem.ToolCall -> "tool_call"
    is ChatItem.UsageInfo -> "usage"
    is ChatItem.FileDiff -> "file_diff"
    is ChatItem.Approval -> "approval"
    is ChatItem.HookEvent -> "hook_event"
    is ChatItem.TodoUpdate -> "todo_update"
}

@Composable
private fun ToolCallGroupView(
    items: List<ChatItem.ToolCall>,
    startIndex: Int,
    expandedMap: MutableMap<Int, Boolean>,
) {
    var allExpanded by remember { mutableStateOf(false) }
    val runningCount = items.count { it.status == ToolCallStatus.RUNNING }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
        color = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(Modifier.animateContentSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        allExpanded = !allExpanded
                        items.indices.forEach { expandedMap[startIndex + it] = allExpanded }
                    }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ActionGlyphIcon(
                    glyph = if (allExpanded) ActionGlyph.CHEVRON_DOWN else ActionGlyph.CHEVRON_UP,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    iconTint = MaterialTheme.colorScheme.outline,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    stringResource(R.string.chat_message_tool_steps, items.size),
                    style = MaterialTheme.typography.labelMedium,
                )
                if (runningCount > 0) {
                    Spacer(Modifier.width(8.dp))
                    ShimmerDot()
                }
                Spacer(Modifier.weight(1f))
            }

            if (allExpanded || items.indices.any { expandedMap[startIndex + it] == true }) {
                items.forEachIndexed { offset, step ->
                    if (offset > 0) {
                        HorizontalDivider(
                            modifier = Modifier.padding(horizontal = 10.dp),
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                        )
                    }
                    val index = startIndex + offset
                    val expanded = expandedMap[index] ?: false
                    StepItem(
                        step = step,
                        expanded = expanded,
                        onToggle = { expandedMap[index] = !expanded },
                    )
                }
            }
        }
    }
}

@Composable
private fun StepItem(
    step: ChatItem.ToolCall,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = step.result != null) { onToggle() }
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .animateContentSize()
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = toolIcon(step.tool),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.width(20.dp),
            )
            Text(
                text = step.tool,
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = extractDetail(step.summary),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(4.dp))
            when (step.status) {
                ToolCallStatus.RUNNING -> ShimmerDot()
                ToolCallStatus.SUCCESS -> ActionGlyphIcon(
                    glyph = ActionGlyph.CHECK,
                    contentDescription = stringResource(R.string.chat_message_cd_done),
                    modifier = Modifier.size(14.dp),
                    iconTint = MaterialTheme.colorScheme.primary,
                )
                ToolCallStatus.AWAITING_APPROVAL -> ActionGlyphIcon(
                    glyph = ActionGlyph.HOURGLASS,
                    contentDescription = stringResource(R.string.chat_topbar_status_waiting_approval),
                    modifier = Modifier.size(14.dp),
                    iconTint = MaterialTheme.colorScheme.tertiary,
                )
                ToolCallStatus.ERROR -> ActionGlyphIcon(
                    glyph = ActionGlyph.ALERT_CIRCLE,
                    contentDescription = stringResource(R.string.chat_message_cd_error),
                    modifier = Modifier.size(14.dp),
                    iconTint = MaterialTheme.colorScheme.error,
                )
            }
        }

        if (expanded && step.result != null) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Spacer(
                    Modifier.padding(start = 8.dp, end = 12.dp)
                        .width(1.dp)
                        .height(30.dp)
                        .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                )
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth().weight(1f)
                ) {
                    Text(
                        text = step.result,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(10.dp),
                        maxLines = 20,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun ShimmerDot() {
    val transition = rememberInfiniteTransition(label = "stepShimmer")
    val alpha by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "stepShimmerAlpha",
    )

    Box(
        modifier = Modifier
            .size(6.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = alpha)),
    )
}

internal fun shouldAutoScrollToBottom(
    previousTotalItems: Int,
    lastVisibleIndex: Int,
    newTotalItems: Int,
    threshold: Int = 2,
): Boolean {
    if (newTotalItems <= 0) return false
    if (newTotalItems <= previousTotalItems) return false
    if (previousTotalItems <= threshold) return true
    return lastVisibleIndex >= previousTotalItems - threshold
}

internal fun accumulateUnreadMessageCount(
    previousTotalItems: Int,
    newTotalItems: Int,
    lastVisibleIndex: Int,
    previousUnreadCount: Int,
    threshold: Int = 2,
): Int {
    val addedCount = (newTotalItems - previousTotalItems).coerceAtLeast(0)
    if (addedCount == 0) return previousUnreadCount
    return if (shouldAutoScrollToBottom(previousTotalItems, lastVisibleIndex, newTotalItems, threshold)) {
        0
    } else {
        previousUnreadCount + addedCount
    }
}

private fun toolIcon(tool: String): String = when (tool.lowercase()) {
    "read" -> "📖"
    "write" -> "📝"
    "edit" -> "✏️"
    "bash" -> "⌘"
    "grep" -> "🔎"
    "glob" -> "🗂️"
    "webfetch" -> "🌐"
    "websearch" -> "🔍"
    "task" -> "🧩"
    "lsp" -> "🧠"
    "notebookedit" -> "📓"
    else -> "🛠️"
}

private fun extractDetail(summary: String?): String {
    if (summary.isNullOrBlank()) return ""
    val parts = summary.split("  ", limit = 2)
    return if (parts.size > 1) parts[1] else summary
}

private fun DisplayGroup.firstTimestamp(): Long? = when (this) {
    is DisplayGroup.Single -> (item as? ChatItem.Text)?.ts
    is DisplayGroup.ToolCallGroup -> null
}

private fun DisplayGroup.lastTimestamp(): Long? = when (this) {
    is DisplayGroup.Single -> (item as? ChatItem.Text)?.ts
    is DisplayGroup.ToolCallGroup -> null
}

private fun shouldShowTimeSeparator(previous: Long?, current: Long?): Boolean {
    if (current == null) return false
    if (previous == null) return true
    return current - previous > 30 * 60 * 1000L
}

@Composable
private fun formatTimeSeparator(ts: Long): String {
    val now = System.currentTimeMillis()
    val oneDay = 24 * 60 * 60 * 1000L
    val time = DateFormat.format("HH:mm", ts).toString()
    return when {
        now - ts < oneDay -> stringResource(R.string.chat_message_time_today, time)
        now - ts < 2 * oneDay -> stringResource(R.string.chat_message_time_yesterday, time)
        else -> DateFormat.format("MM-dd HH:mm", ts).toString()
    }
}

@Composable
private fun TimeSeparator(ts: Long) {
    val label = formatTimeSeparator(ts)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Spacer(Modifier.weight(1f).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 10.dp)
        )
        Spacer(Modifier.weight(1f).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}

@Composable
private fun MessageSkeleton(modifier: Modifier = Modifier) {
    val brush = shimmerBrush()
    Column(
        modifier = modifier.padding(horizontal = 12.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        repeat(3) { index ->
            Box(
                Modifier
                    .fillMaxWidth(if (index % 2 == 0) 0.8f else 0.6f)
                    .height(16.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(brush)
            )
        }
    }
}

@Composable
private fun shimmerBrush(): Brush {
    val transition = rememberInfiniteTransition(label = "skeletonShimmer")
    val offset by transition.animateFloat(
        initialValue = 0f,
        targetValue = 800f,
        animationSpec = infiniteRepeatable(animation = tween(1100), repeatMode = RepeatMode.Restart),
        label = "shimmerOffset"
    )
    return Brush.linearGradient(
        colors = listOf(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.surface,
            MaterialTheme.colorScheme.surfaceVariant
        ),
        start = Offset(offset - 240f, 0f),
        end = Offset(offset, 0f)
    )
}





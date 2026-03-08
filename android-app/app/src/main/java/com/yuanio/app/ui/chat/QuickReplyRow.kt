package com.yuanio.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yuanio.app.data.PromptDetector

@Composable
fun QuickReplyRow(
    replies: List<PromptDetector.QuickReply>,
    onReplyClick: (PromptDetector.QuickReply) -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
) {
    if (replies.isEmpty()) return
    Column(modifier = modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        if (!title.isNullOrBlank()) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
        }
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(replies, key = { it.value }) { reply ->
                AssistChip(
                    onClick = { onReplyClick(reply) },
                    label = { Text(reply.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                )
            }
        }
    }
}

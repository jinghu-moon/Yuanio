package sy.yuanio.app.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R

@Composable
internal fun TaskChatPreviewSection(
    preview: TaskChatActivityEntry,
    modifier: Modifier = Modifier,
    labelColor: Color = MaterialTheme.colorScheme.outline,
    summaryColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = stringResource(R.string.task_chat_preview_title),
            style = MaterialTheme.typography.labelMedium,
            color = labelColor,
        )
        Text(
            text = preview.summary,
            style = MaterialTheme.typography.bodySmall,
            color = summaryColor,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}


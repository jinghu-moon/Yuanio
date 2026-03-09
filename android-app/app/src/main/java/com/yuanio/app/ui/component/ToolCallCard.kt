package com.yuanio.app.ui.component

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.ui.model.ToolCallStatus

@Composable
fun ToolCallCard(
    tool: String,
    status: ToolCallStatus,
    result: String?,
    modifier: Modifier = Modifier,
    summary: String? = null,
    agent: String? = null,
    expanded: Boolean = false,
    onToggle: (() -> Unit)? = null,
) {
    val (iconRes, color, statusLabel) = when (status) {
        ToolCallStatus.RUNNING -> Triple(
            R.drawable.ic_tb_hourglass_empty,
            MaterialTheme.colorScheme.primary,
            stringResource(R.string.chat_topbar_status_running),
        )
        ToolCallStatus.SUCCESS -> Triple(
            R.drawable.ic_tb_check,
            MaterialTheme.colorScheme.primary,
            stringResource(R.string.common_done),
        )
        ToolCallStatus.AWAITING_APPROVAL -> Triple(
            R.drawable.ic_tb_hourglass_empty,
            MaterialTheme.colorScheme.tertiary,
            stringResource(R.string.chat_topbar_status_waiting_approval),
        )
        ToolCallStatus.ERROR -> Triple(
            R.drawable.ic_tb_alert_circle,
            MaterialTheme.colorScheme.error,
            stringResource(R.string.chat_topbar_status_error),
        )
    }

    Column(
        modifier
            .fillMaxWidth()
            .animateContentSize(spring(stiffness = Spring.StiffnessMediumLow))
    ) {
        Surface(
            shape = MaterialTheme.shapes.small,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
            color = Color.Transparent,
            contentColor = MaterialTheme.colorScheme.onSurface,
            modifier = if (onToggle != null) Modifier.clickable { onToggle() } else Modifier,
        ) {
            Row(
                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(iconRes),
                    contentDescription = statusLabel,
                    tint = color,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    summary ?: tool,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.weight(1f, fill = false),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!agent.isNullOrBlank()) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        agent.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = agentColor(agent),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (onToggle != null) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        painter = painterResource(
                            if (expanded) R.drawable.ic_tb_chevron_up else R.drawable.ic_tb_chevron_down
                        ),
                        contentDescription = if (expanded) {
                            stringResource(R.string.common_collapse)
                        } else {
                            stringResource(R.string.common_expand)
                        },
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }

        if (expanded && (!result.isNullOrBlank() || status == ToolCallStatus.RUNNING)) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Spacer(
                    Modifier
                        .padding(start = 12.dp, end = 12.dp)
                        .width(1.dp)
                        .height(30.dp)
                        .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                )
                Column(Modifier.weight(1f)) {
                    if (status == ToolCallStatus.RUNNING) {
                        LinearProgressIndicator(
                            Modifier.fillMaxWidth().padding(bottom = 6.dp)
                        )
                    }
                    if (!result.isNullOrBlank()) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = result,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(10.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

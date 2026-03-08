package com.yuanio.app.ui.component

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yuanio.app.R

@Composable
fun ToolCallCard(
    tool: String,
    status: String,
    result: String?,
    modifier: Modifier = Modifier,
    summary: String? = null,
    agent: String? = null,
    expanded: Boolean = false,
    onToggle: (() -> Unit)? = null,
) {
    val (iconRes, color) = when (status) {
        "running" -> R.drawable.ic_ms_hourglass_top to MaterialTheme.colorScheme.primary
        "done" -> R.drawable.ic_ms_check_circle to MaterialTheme.colorScheme.primary
        else -> R.drawable.ic_ms_error to MaterialTheme.colorScheme.error
    }
    val statusLabel = when (status) {
        "running" -> stringResource(R.string.chat_topbar_status_running)
        "done" -> stringResource(R.string.common_done)
        else -> stringResource(R.string.chat_topbar_status_error)
    }

    Column(
        modifier
            .fillMaxWidth()
            .animateContentSize(spring(stiffness = Spring.StiffnessMediumLow))
    ) {
        Surface(
            shape = MaterialTheme.shapes.small, // 对应 8dp 圆角
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
            color = Color.Transparent, // Geist 风格底层使用透明或极其克制的表面色
            contentColor = MaterialTheme.colorScheme.onSurface,
            modifier = if (onToggle != null) Modifier.clickable { onToggle() } else Modifier
        ) {
            Row(
                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    painter = painterResource(iconRes),
                    contentDescription = statusLabel,
                    tint = color,
                    modifier = Modifier.size(14.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    summary ?: tool,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.weight(1f, fill = false),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (!agent.isNullOrBlank()) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        agent.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = agentColor(agent),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (onToggle != null) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        painter = painterResource(
                            if (expanded) R.drawable.ic_ms_keyboard_arrow_up
                            else R.drawable.ic_ms_keyboard_arrow_down
                        ),
                        contentDescription = if (expanded) {
                            stringResource(R.string.common_collapse)
                        } else {
                            stringResource(R.string.common_expand)
                        },
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.outline
                    )
                }
            }
        }

        // 展开时显示详情，沿用左侧线条作为缩进指示 (类似 HTML Demo 的 :before)
        if (expanded && (!result.isNullOrBlank() || status == "running")) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Spacer(
                    Modifier.padding(start = 12.dp, end = 12.dp)
                        .width(1.dp)
                        .height(30.dp) // 仅作最小高度保证，如果是长文本则跟随内容
                        .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                )
                Column(Modifier.weight(1f)) {
                    if (status == "running") {
                        LinearProgressIndicator(
                            Modifier.fillMaxWidth().padding(bottom = 6.dp)
                        )
                    }
                    if (!result.isNullOrBlank()) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                result,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

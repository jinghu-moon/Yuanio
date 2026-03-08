package com.yuanio.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yuanio.app.R
import com.yuanio.app.ui.theme.LocalYuanioColors

enum class DiffLineKind {
    META,
    HUNK,
    ADDITION,
    DELETION,
    CONTEXT,
}

data class DiffLineUi(
    val text: String,
    val kind: DiffLineKind,
)

data class DiffViewerModel(
    val allLines: List<DiffLineUi>,
    val visibleLines: List<DiffLineUi>,
    val canExpand: Boolean,
    val hiddenLineCount: Int,
)

internal fun parseUnifiedDiffLines(diff: String): List<DiffLineUi> {
    val normalized = diff.replace("\r\n", "\n")
    if (normalized.isBlank()) return emptyList()
    return normalized.lines().map { line ->
        DiffLineUi(
            text = line,
            kind = when {
                line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") -> DiffLineKind.META
                line.startsWith("@@") -> DiffLineKind.HUNK
                line.startsWith("+") && !line.startsWith("+++") -> DiffLineKind.ADDITION
                line.startsWith("-") && !line.startsWith("---") -> DiffLineKind.DELETION
                else -> DiffLineKind.CONTEXT
            },
        )
    }
}

internal fun buildDiffViewerModel(
    diff: String,
    expanded: Boolean,
    collapsedLineCount: Int = 12,
): DiffViewerModel {
    val allLines = parseUnifiedDiffLines(diff)
    val normalizedCollapsedCount = collapsedLineCount.coerceAtLeast(1)
    val canExpand = allLines.size > normalizedCollapsedCount
    val visibleLines = if (expanded || !canExpand) {
        allLines
    } else {
        allLines.take(normalizedCollapsedCount)
    }
    return DiffViewerModel(
        allLines = allLines,
        visibleLines = visibleLines,
        canExpand = canExpand,
        hiddenLineCount = (allLines.size - visibleLines.size).coerceAtLeast(0),
    )
}

internal fun looksLikeUnifiedDiff(text: String): Boolean {
    if (text.isBlank()) return false
    val normalized = text.replace("\r\n", "\n")
    val lines = normalized.lines().filter { it.isNotBlank() }
    if (lines.isEmpty()) return false
    return lines.any { it.startsWith("@@") || it.startsWith("diff --git") }
        || (lines.any { it.startsWith("---") } && lines.any { it.startsWith("+++") })
}

@Composable
fun DiffViewer(
    path: String,
    diff: String,
    action: String,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
    showToggle: Boolean = true,
    collapsedLineCount: Int = 12,
) {
    val vibeCastColors = LocalYuanioColors.current
    val actionLabel = when (action) {
        "created" -> stringResource(R.string.diff_action_created)
        "deleted" -> stringResource(R.string.diff_action_deleted)
        else -> stringResource(R.string.diff_action_modified)
    }
    val actionColor = when (action) {
        "created" -> vibeCastColors.success
        "deleted" -> MaterialTheme.colorScheme.error
        else -> vibeCastColors.warning
    }

    var expanded by rememberSaveable(path, diff, showToggle) {
        mutableStateOf(initiallyExpanded || !showToggle)
    }
    val renderExpanded = if (showToggle) expanded else true
    val model = remember(diff, renderExpanded, collapsedLineCount) {
        buildDiffViewerModel(
            diff = diff,
            expanded = renderExpanded,
            collapsedLineCount = collapsedLineCount,
        )
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(actionLabel, color = actionColor, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = path,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.weight(1f),
                )
                if (showToggle && model.canExpand) {
                    TextButton(onClick = { expanded = !expanded }) {
                        Text(
                            if (expanded) {
                                stringResource(R.string.common_collapse)
                            } else {
                                stringResource(R.string.common_expand)
                            },
                        )
                    }
                }
            }

            if (model.allLines.isEmpty()) {
                Text(
                    text = stringResource(R.string.git_diff_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            } else {
                Column(
                    Modifier
                        .horizontalScroll(rememberScrollState())
                        .padding(bottom = 8.dp, start = 12.dp, end = 12.dp),
                ) {
                    model.visibleLines.forEach { line ->
                        val (backgroundColor, foregroundColor) = diffLineColors(line.kind, vibeCastColors)
                        Text(
                            text = line.text,
                            color = foregroundColor,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .background(backgroundColor)
                                .fillMaxWidth(),
                        )
                    }
                    if (showToggle && !expanded && model.hiddenLineCount > 0) {
                        Text(
                            text = "… +${model.hiddenLineCount}",
                            color = MaterialTheme.colorScheme.outline,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun diffLineColors(
    kind: DiffLineKind,
    vibeCastColors: com.yuanio.app.ui.theme.YuanioColors,
): Pair<Color, Color> {
    return when (kind) {
        DiffLineKind.ADDITION -> vibeCastColors.success.copy(alpha = 0.12f) to vibeCastColors.success
        DiffLineKind.DELETION -> MaterialTheme.colorScheme.error.copy(alpha = 0.12f) to MaterialTheme.colorScheme.error
        DiffLineKind.HUNK -> Color.Transparent to vibeCastColors.info
        DiffLineKind.META -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f) to MaterialTheme.colorScheme.onSecondaryContainer
        DiffLineKind.CONTEXT -> Color.Transparent to MaterialTheme.colorScheme.onSurfaceVariant
    }
}

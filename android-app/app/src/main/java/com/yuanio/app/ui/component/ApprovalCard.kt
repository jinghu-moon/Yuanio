package com.yuanio.app.ui.component

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.ui.model.ApprovalType
import com.yuanio.app.ui.model.ChatItem
import kotlinx.coroutines.delay

internal enum class ApprovalPreviewMode {
    NONE,
    TEXT,
    DIFF,
}

internal enum class ApprovalMetaType {
    TOOL,
    PERMISSION,
    CONTEXT,
}

internal enum class ApprovalDismissDecision {
    APPROVE,
    REJECT,
}

internal data class ApprovalMetaItem(
    val type: ApprovalMetaType,
    val value: String,
)

internal data class ApprovalCardModel(
    val type: ApprovalType,
    val metaItems: List<ApprovalMetaItem>,
    val previewMode: ApprovalPreviewMode,
    val previewContent: String?,
    val previewAction: String,
    val previewPath: String,
    val files: List<String>,
    val diffHighlights: List<String>,
) {
    val metadata: List<String>
        get() = metaItems.map { "${it.type.name.lowercase()}: ${it.value}" }
}

internal data class ApprovalDismissPlan(
    val visible: Boolean = true,
    val actionsEnabled: Boolean = true,
    val decision: ApprovalDismissDecision? = null,
)

internal const val ApprovalDismissAnimationMillis = 200

internal fun buildApprovalCardModel(approval: ChatItem.Approval): ApprovalCardModel {
    val previewMode = when {
        approval.preview.isNullOrBlank() -> ApprovalPreviewMode.NONE
        approval.approvalType == ApprovalType.EDIT && looksLikeUnifiedDiff(approval.preview) -> ApprovalPreviewMode.DIFF
        else -> ApprovalPreviewMode.TEXT
    }
    val metaItems = buildList {
        add(ApprovalMetaItem(ApprovalMetaType.TOOL, approval.tool))
        approval.permissionMode?.takeIf { it.isNotBlank() }?.let {
            add(ApprovalMetaItem(ApprovalMetaType.PERMISSION, it))
        }
        approval.context?.takeIf { it.isNotBlank() }?.let {
            add(ApprovalMetaItem(ApprovalMetaType.CONTEXT, it))
        }
    }
    return ApprovalCardModel(
        type = approval.approvalType,
        metaItems = metaItems,
        previewMode = previewMode,
        previewContent = approval.preview,
        previewAction = inferApprovalPreviewAction(approval.preview),
        previewPath = approval.files.firstOrNull() ?: approval.tool,
        files = approval.files,
        diffHighlights = approval.diffHighlights,
    )
}

internal fun inferApprovalPreviewAction(preview: String?): String {
    if (preview.isNullOrBlank()) return "modified"
    val lines = preview.replace("\r\n", "\n").lines()
    val hasAddition = lines.any { it.startsWith("+") && !it.startsWith("+++") }
    val hasDeletion = lines.any { it.startsWith("-") && !it.startsWith("---") }
    return when {
        hasAddition && hasDeletion -> "modified"
        hasAddition -> "created"
        hasDeletion -> "deleted"
        else -> "modified"
    }
}

internal fun startApprovalDismiss(
    current: ApprovalDismissPlan,
    decision: ApprovalDismissDecision,
): ApprovalDismissPlan {
    if (current.decision != null) return current
    return ApprovalDismissPlan(
        visible = false,
        actionsEnabled = false,
        decision = decision,
    )
}

@Composable
fun ApprovalCard(
    approval: ChatItem.Approval,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
) {
    val model = remember(approval) { buildApprovalCardModel(approval) }
    val borderColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.8f)
        } else {
            riskColor(approval.riskLevel).copy(alpha = 0.5f)
        },
        label = "approvalCardBorderColor",
    )
    val containerColor by animateColorAsState(
        targetValue = if (highlighted) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        } else {
            Color.Transparent
        },
        label = "approvalCardContainerColor",
    )
    var dismissPlan by remember(approval.id) { mutableStateOf(ApprovalDismissPlan()) }

    LaunchedEffect(dismissPlan.decision) {
        when (dismissPlan.decision) {
            ApprovalDismissDecision.APPROVE -> {
                delay(ApprovalDismissAnimationMillis.toLong())
                onApprove()
            }
            ApprovalDismissDecision.REJECT -> {
                delay(ApprovalDismissAnimationMillis.toLong())
                onReject()
            }
            null -> Unit
        }
    }

    AnimatedVisibility(
        visible = dismissPlan.visible,
        modifier = modifier.fillMaxWidth(),
        exit = fadeOut(animationSpec = tween(ApprovalDismissAnimationMillis)) +
            scaleOut(
                targetScale = 0.97f,
                animationSpec = tween(ApprovalDismissAnimationMillis),
            ),
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, borderColor),
            color = containerColor,
        ) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ActionGlyphIcon(
                        glyph = ActionGlyph.WARNING,
                        contentDescription = stringResource(R.string.approval_cd_request),
                        iconTint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    val brand = agentToBrand(approval.agent)
                    if (brand != null) {
                        BrandIcon(
                            brand = brand,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        text = stringResource(R.string.approval_title),
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.weight(1f),
                    )
                    ApprovalTypeBadge(model.type)
                }

                Spacer(Modifier.height(8.dp))
                Text(approval.desc, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    text = stringResource(R.string.approval_risk, riskLabel(approval.riskLevel)),
                    style = MaterialTheme.typography.bodySmall,
                    color = riskColor(approval.riskLevel),
                )
                if (approval.riskSummary.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = approval.riskSummary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                if (model.metaItems.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    model.metaItems.forEach { item ->
                        Text(
                            text = "${approvalMetaLabel(item.type)}: ${item.value}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }

                when (model.previewMode) {
                    ApprovalPreviewMode.DIFF -> {
                        Spacer(Modifier.height(10.dp))
                        DiffViewer(
                            path = model.previewPath,
                            diff = model.previewContent.orEmpty(),
                            action = model.previewAction,
                            initiallyExpanded = false,
                            showToggle = true,
                            collapsedLineCount = 8,
                        )
                    }
                    ApprovalPreviewMode.TEXT -> {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = stringResource(R.string.approval_preview),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        ) {
                            Text(
                                text = model.previewContent.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                            )
                        }
                    }
                    ApprovalPreviewMode.NONE -> Unit
                }

                if (model.diffHighlights.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.approval_diff_highlights),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    model.diffHighlights.take(3).forEach { line ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        ) {
                            Text(
                                text = line,
                                style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                maxLines = 2,
                            )
                        }
                    }
                }

                if (model.files.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.approval_files),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    model.files.forEach { file ->
                        Text(
                            text = stringResource(R.string.approval_file_item, file),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = {
                            dismissPlan = startApprovalDismiss(dismissPlan, ApprovalDismissDecision.REJECT)
                        },
                        enabled = dismissPlan.actionsEnabled,
                    ) {
                        Text(
                            text = stringResource(R.string.notifier_action_reject),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            dismissPlan = startApprovalDismiss(dismissPlan, ApprovalDismissDecision.APPROVE)
                        },
                        enabled = dismissPlan.actionsEnabled,
                        colors = ButtonDefaults.buttonColors(containerColor = riskColor(approval.riskLevel)),
                    ) {
                        Text(stringResource(R.string.notifier_action_approve))
                    }
                }
            }
        }
    }
}

@Composable
fun ApprovalCard(
    description: String,
    tool: String,
    files: List<String>,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    riskLevel: String = "medium",
    riskSummary: String = "",
    diffHighlights: List<String> = emptyList(),
    agent: String? = null,
) {
    ApprovalCard(
        approval = ChatItem.Approval(
            id = "approval_preview",
            desc = description,
            tool = tool,
            files = files,
            riskLevel = riskLevel,
            riskSummary = riskSummary,
            diffHighlights = diffHighlights,
            agent = agent,
        ),
        onApprove = onApprove,
        onReject = onReject,
        modifier = modifier,
        highlighted = highlighted,
    )
}

@Composable
private fun ApprovalTypeBadge(type: ApprovalType) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Text(
            text = when (type) {
                ApprovalType.EXEC -> stringResource(R.string.approval_type_exec)
                ApprovalType.EDIT -> stringResource(R.string.approval_type_edit)
                ApprovalType.MCP -> stringResource(R.string.approval_type_mcp)
                ApprovalType.GENERIC -> stringResource(R.string.approval_type_generic)
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun approvalMetaLabel(type: ApprovalMetaType): String {
    return when (type) {
        ApprovalMetaType.TOOL -> stringResource(R.string.approval_tool_label)
        ApprovalMetaType.PERMISSION -> stringResource(R.string.approval_permission_label)
        ApprovalMetaType.CONTEXT -> stringResource(R.string.approval_context_label)
    }
}

@Composable
private fun riskColor(level: String): Color {
    return when (level.lowercase()) {
        "low", "safe" -> MaterialTheme.colorScheme.primary
        "high" -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.tertiary
    }
}

@Composable
private fun riskLabel(level: String): String {
    return when (level.lowercase()) {
        "low" -> stringResource(R.string.risk_low)
        "safe" -> stringResource(R.string.risk_low_safe)
        "high" -> stringResource(R.string.risk_high)
        else -> stringResource(R.string.risk_medium)
    }
}

package com.yuanio.app.ui.screen

import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yuanio.app.R
import com.yuanio.app.data.ChatHistory
import com.yuanio.app.data.InteractionDispatchResult
import com.yuanio.app.data.WorkflowSnapshotStore
import com.yuanio.app.data.sendOrQueueApprovalResponse
import com.yuanio.app.ui.component.ApprovalCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalInboxScreen(
    onBack: () -> Unit,
    onOpenHome: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenResultDetail: (String) -> Unit,
    requestedApprovalId: String? = null,
) {
    val context = LocalContext.current
    val snapshot by WorkflowSnapshotStore.snapshot.collectAsStateWithLifecycle()
    val chatHistory = remember(context) { ChatHistory(context) }
    val refreshState = rememberWorkflowRefreshUiState(command = "/approvals")
    val listState = rememberLazyListState()
    val requestedFocusId = requestedApprovalId?.trim().orEmpty()
    var activeFocusedApprovalId by remember(requestedFocusId) { mutableStateOf(requestedFocusId) }
    var displayFocusKind by remember(requestedFocusId) {
        mutableStateOf(
            if (requestedFocusId.isBlank()) {
                ApprovalRefreshFocusKind.NONE
            } else {
                ApprovalRefreshFocusKind.FOCUSED_APPROVAL
            }
        )
    }
    var consumedRequestedApprovalFocus by remember(requestedFocusId) { mutableStateOf(false) }
    var focusHighlightToken by remember { mutableStateOf(0L) }
    var focusHighlightKind by remember { mutableStateOf(ApprovalRefreshFocusKind.NONE) }
    var autoAdvanceToken by remember { mutableStateOf(0L) }
    var lastResultTaskId by remember { mutableStateOf<String?>(null) }
    var resultBannerToken by remember { mutableStateOf(0L) }
    val taskChatEntries = remember(chatHistory, snapshot.sessionId) {
        snapshot.sessionId?.trim()?.takeIf { it.isNotBlank() }?.let(chatHistory::loadEntries).orEmpty()
    }
    val lastResultTaskChatPreview = remember(taskChatEntries, lastResultTaskId) {
        resolveApprovalTaskChatPreview(taskChatEntries, lastResultTaskId)
    }
    val effectiveFocusedApprovalId = activeFocusedApprovalId.trim()
    val displayedApprovals = if (
        displayFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL &&
        effectiveFocusedApprovalId.isNotBlank()
    ) {
        snapshot.pendingApprovals.sortedByDescending { it.id == effectiveFocusedApprovalId }
    } else {
        snapshot.pendingApprovals
    }
    val focusedApproval = displayedApprovals.firstOrNull { it.id == effectiveFocusedApprovalId }
    val focusHighlightTarget = resolveApprovalFocusHighlightTarget(
        focusedApprovalId = effectiveFocusedApprovalId,
        displayedApprovals = displayedApprovals,
        focusKind = focusHighlightKind,
    )
    val focusHighlighted = rememberTransientHighlight(focusHighlightToken)
    val resultBannerHighlighted = rememberTransientHighlight(resultBannerToken)

    LaunchedEffect(effectiveFocusedApprovalId, snapshot.updatedAt, displayedApprovals.size, consumedRequestedApprovalFocus) {
        if (consumedRequestedApprovalFocus) return@LaunchedEffect
        val target = resolveRequestedApprovalScrollTarget(
            requestedApprovalId = effectiveFocusedApprovalId,
            displayedApprovals = displayedApprovals,
        ) ?: return@LaunchedEffect
        listState.animateScrollToItem(target.index)
        if (target.focusKind != ApprovalRefreshFocusKind.NONE) {
            Toast.makeText(context, context.getString(R.string.workflow_refresh_focus_approvals_latest), Toast.LENGTH_SHORT).show()
            WorkflowFocusStore.updateApprovalFocus(effectiveFocusedApprovalId, displayedApprovals, target.focusKind)
            focusHighlightKind = target.focusKind
            focusHighlightToken += 1L
        } else {
            WorkflowFocusStore.clearApprovalFocus()
        }
        consumedRequestedApprovalFocus = true
    }

    LaunchedEffect(refreshState.successfulRefreshCount, snapshot.updatedAt, effectiveFocusedApprovalId, displayFocusKind, displayedApprovals.size) {
        if (refreshState.successfulRefreshCount <= 0L) return@LaunchedEffect
        val target = resolveApprovalRefreshScrollTarget(
            focusedApprovalId = effectiveFocusedApprovalId.takeIf {
                displayFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL
            },
            displayedApprovals = displayedApprovals,
        )
        listState.animateScrollToItem(target.index)
        if (target.focusKind != ApprovalRefreshFocusKind.NONE) {
            Toast.makeText(context, context.getString(R.string.workflow_refresh_focus_approvals_latest), Toast.LENGTH_SHORT).show()
            WorkflowFocusStore.updateApprovalFocus(effectiveFocusedApprovalId, displayedApprovals, target.focusKind)
            focusHighlightKind = target.focusKind
            focusHighlightToken += 1L
        } else {
            WorkflowFocusStore.clearApprovalFocus()
        }
    }

    LaunchedEffect(autoAdvanceToken, snapshot.updatedAt, effectiveFocusedApprovalId, displayFocusKind, displayedApprovals.size) {
        if (autoAdvanceToken <= 0L) return@LaunchedEffect
        val target = resolveApprovalRefreshScrollTarget(
            focusedApprovalId = effectiveFocusedApprovalId.takeIf {
                displayFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL
            },
            displayedApprovals = displayedApprovals,
        )
        listState.animateScrollToItem(target.index)
        if (target.focusKind != ApprovalRefreshFocusKind.NONE) {
            WorkflowFocusStore.updateApprovalFocus(effectiveFocusedApprovalId, displayedApprovals, target.focusKind)
            focusHighlightKind = target.focusKind
            focusHighlightToken += 1L
        } else {
            WorkflowFocusStore.clearApprovalFocus()
        }
    }

    fun handleOne(approvalId: String, approved: Boolean) {
        val handledApproval = snapshot.pendingApprovals.firstOrNull { it.id == approvalId }
        when (sendOrQueueApprovalResponse(context, approvalId, approved, handledApproval?.taskId)) {
            InteractionDispatchResult.FAILED -> {
                Toast.makeText(context, context.getString(R.string.approvals_action_failed), Toast.LENGTH_SHORT).show()
            }

            else -> {
                val resultTarget = resolveApprovalResultLinkTarget(
                    handledApprovals = listOfNotNull(handledApproval),
                    snapshot = snapshot,
                )
                val nextFocus = resolveNextApprovalAutoAdvanceTarget(
                    currentFocusedApprovalId = effectiveFocusedApprovalId,
                    currentFocusKind = displayFocusKind,
                    displayedApprovals = displayedApprovals,
                    removedApprovalIds = listOf(approvalId),
                )
                WorkflowSnapshotStore.removeApproval(approvalId)
                lastResultTaskId = resultTarget?.taskId
                if (resultTarget != null) {
                    resultBannerToken += 1L
                }
                activeFocusedApprovalId = nextFocus.focusedApprovalId.orEmpty()
                displayFocusKind = nextFocus.focusKind
                autoAdvanceToken += 1L
                val messageRes = if (approved) R.string.approvals_action_approved else R.string.approvals_action_rejected
                Toast.makeText(context, context.getString(messageRes), Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun handleMany(approvalIds: List<String>, approved: Boolean) {
        val approvalById = snapshot.pendingApprovals.associateBy { it.id }
        val successIds = mutableListOf<String>()
        val successApprovals = mutableListOf<com.yuanio.app.data.WorkflowApprovalSnapshot>()
        approvalIds.forEach { approvalId ->
            val approval = approvalById[approvalId]
            val result = sendOrQueueApprovalResponse(context, approvalId, approved, approval?.taskId)
            if (result != InteractionDispatchResult.FAILED) {
                successIds += approvalId
                if (approval != null) {
                    successApprovals += approval
                }
            }
        }
        if (successIds.isEmpty()) {
            Toast.makeText(context, context.getString(R.string.approvals_action_failed), Toast.LENGTH_SHORT).show()
            return
        }
        val resultTarget = resolveApprovalResultLinkTarget(
            handledApprovals = successApprovals,
            snapshot = snapshot,
        )
        val nextFocus = resolveNextApprovalAutoAdvanceTarget(
            currentFocusedApprovalId = effectiveFocusedApprovalId,
            currentFocusKind = displayFocusKind,
            displayedApprovals = displayedApprovals,
            removedApprovalIds = successIds,
        )
        WorkflowSnapshotStore.removeApprovals(successIds)
        lastResultTaskId = resultTarget?.taskId
        if (resultTarget != null) {
            resultBannerToken += 1L
        }
        activeFocusedApprovalId = nextFocus.focusedApprovalId.orEmpty()
        displayFocusKind = nextFocus.focusKind
        autoAdvanceToken += 1L
        val messageRes = if (approved) R.string.approvals_action_batch_approved else R.string.approvals_action_batch_rejected
        Toast.makeText(context, context.getString(messageRes, successIds.size), Toast.LENGTH_SHORT).show()
    }

    val lowRiskIds = snapshot.pendingApprovals
        .filter { it.riskLevel.equals("low", ignoreCase = true) || it.riskLevel.equals("safe", ignoreCase = true) }
        .map { it.id }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    androidx.compose.foundation.layout.Column {
                        Text(stringResource(R.string.approvals_title))
                        Text(
                            text = stringResource(R.string.approvals_subtitle),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_arrow_left),
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                actions = {
                    WorkflowRefreshActionButton(refreshState = refreshState)
                }
            )
        }
    ) { padding ->
        WorkflowRefreshContainer(
            refreshState = refreshState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    ) {
                        androidx.compose.foundation.layout.Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.approvals_summary, snapshot.pendingApprovalCount),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            androidx.compose.foundation.layout.Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    onClick = { handleMany(lowRiskIds, approved = true) },
                                    enabled = lowRiskIds.isNotEmpty(),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(stringResource(R.string.approvals_action_approve_low_risk, lowRiskIds.size))
                                }
                                OutlinedButton(
                                    onClick = { handleMany(snapshot.pendingApprovals.map { it.id }, approved = true) },
                                    enabled = snapshot.pendingApprovals.isNotEmpty(),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(stringResource(R.string.chat_approval_all_approve))
                                }
                            }
                            Button(
                                onClick = { handleMany(snapshot.pendingApprovals.map { it.id }, approved = false) },
                                enabled = snapshot.pendingApprovals.isNotEmpty(),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(stringResource(R.string.chat_approval_all_reject))
                            }
                        }
                    }
                }

                if (!lastResultTaskId.isNullOrBlank()) {
                    item {
                        val resultBannerColor by animateColorAsState(
                            targetValue = if (resultBannerHighlighted) {
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f)
                            } else {
                                MaterialTheme.colorScheme.tertiaryContainer
                            },
                            label = "approvalResultBannerColor",
                        )
                        val resultBannerBorderColor by animateColorAsState(
                            targetValue = if (resultBannerHighlighted) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.75f)
                            } else {
                                Color.Transparent
                            },
                            label = "approvalResultBannerBorderColor",
                        )
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = resultBannerColor),
                            border = BorderStroke(1.dp, resultBannerBorderColor),
                        ) {
                            androidx.compose.foundation.layout.Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = stringResource(R.string.approvals_result_ready_title),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                )
                                Text(
                                    text = stringResource(R.string.approvals_result_ready_summary, lastResultTaskId.orEmpty()),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                )
                                lastResultTaskChatPreview?.let { preview ->
                                    TaskChatPreviewSection(
                                        preview = preview,
                                        labelColor = MaterialTheme.colorScheme.onTertiaryContainer,
                                        summaryColor = MaterialTheme.colorScheme.onTertiaryContainer,
                                    )
                                }
                                OutlinedButton(
                                    onClick = { lastResultTaskId?.let(onOpenResultDetail) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(stringResource(R.string.approvals_action_open_result))
                                }
                            }
                        }
                    }
                }

                if (displayFocusKind == ApprovalRefreshFocusKind.FOCUSED_APPROVAL && effectiveFocusedApprovalId.isNotBlank()) {
                    item {
                        val focusBannerHighlighted = focusHighlighted && focusHighlightTarget.highlightBanner
                        val focusBannerColor by animateColorAsState(
                            targetValue = if (focusBannerHighlighted) {
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f)
                            } else {
                                MaterialTheme.colorScheme.secondaryContainer
                            },
                            label = "approvalFocusBannerColor",
                        )
                        val focusBannerBorderColor by animateColorAsState(
                            targetValue = if (focusBannerHighlighted) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.75f)
                            } else {
                                Color.Transparent
                            },
                            label = "approvalFocusBannerBorderColor",
                        )
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = focusBannerColor),
                            border = BorderStroke(1.dp, focusBannerBorderColor),
                        ) {
                            androidx.compose.foundation.layout.Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    text = stringResource(R.string.approvals_focus_title),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                                if (focusedApproval != null) {
                                    Text(
                                        text = focusedApproval.desc,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                    Text(
                                        text = focusedApproval.id,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                } else {
                                    Text(
                                        text = stringResource(R.string.approvals_focus_missing, effectiveFocusedApprovalId),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                }
                            }
                        }
                    }
                }

                if (displayedApprovals.isEmpty()) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            androidx.compose.foundation.layout.Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text(
                                    text = stringResource(R.string.approvals_empty),
                                    color = MaterialTheme.colorScheme.outline,
                                )
                                androidx.compose.foundation.layout.Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    OutlinedButton(onClick = onOpenHome, modifier = Modifier.weight(1f)) {
                                        Text(stringResource(R.string.empty_state_action_home))
                                    }
                                    OutlinedButton(onClick = onOpenChat, modifier = Modifier.weight(1f)) {
                                        Text(stringResource(R.string.empty_state_action_chat))
                                    }
                                }
                            }
                        }
                    }
                } else {
                    items(displayedApprovals, key = { it.id }) { approval ->
                        ApprovalCard(
                            approval = approval.toChatItem(),
                            highlighted = focusHighlighted && focusHighlightTarget.approvalId == approval.id,
                            onApprove = { handleOne(approval.id, approved = true) },
                            onReject = { handleOne(approval.id, approved = false) },
                        )
                    }
                }
            }
        }
    }
}

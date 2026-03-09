package com.yuanio.app.ui.screen

import android.os.SystemClock
import android.widget.Toast
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.size
import com.yuanio.app.R
import com.yuanio.app.data.sendAgentCommand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal const val WORKFLOW_REFRESH_COOLDOWN_MS = 1_200L

internal class WorkflowRefreshThrottler(
    private val cooldownMs: Long = WORKFLOW_REFRESH_COOLDOWN_MS,
    private val nowMs: () -> Long = { SystemClock.elapsedRealtime() },
) {
    private var lastAcceptedAtMs: Long? = null

    fun tryAcquire(): Boolean {
        val currentTimeMs = nowMs()
        val previousAcceptedAtMs = lastAcceptedAtMs
        if (previousAcceptedAtMs != null && currentTimeMs - previousAcceptedAtMs < cooldownMs) {
            return false
        }
        lastAcceptedAtMs = currentTimeMs
        return true
    }
}

@Stable
internal class WorkflowRefreshUiState(
    val isRefreshing: Boolean,
    val successfulRefreshCount: Long,
    private val onRefreshRequest: () -> Unit,
) {
    fun requestRefresh() = onRefreshRequest()
}

@Composable
internal fun rememberWorkflowRefreshUiState(
    command: String,
    cooldownMs: Long = WORKFLOW_REFRESH_COOLDOWN_MS,
): WorkflowRefreshUiState {
    return rememberWorkflowRefreshUiState(
        commands = listOf(command),
        cooldownMs = cooldownMs,
    )
}

@Composable
internal fun rememberWorkflowRefreshUiState(
    commands: List<String>,
    cooldownMs: Long = WORKFLOW_REFRESH_COOLDOWN_MS,
): WorkflowRefreshUiState {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val normalizedCommands = remember(commands) {
        commands.map { it.trim() }.filter { it.isNotBlank() }.distinct()
    }
    val throttler = remember(normalizedCommands, cooldownMs) {
        WorkflowRefreshThrottler(cooldownMs = cooldownMs)
    }
    var isRefreshing by remember(normalizedCommands) { mutableStateOf(false) }
    var successfulRefreshCount by remember(normalizedCommands) { mutableStateOf(0L) }

    val onRefreshRequest: () -> Unit = refreshRequest@{
        if (isRefreshing) return@refreshRequest
        if (!throttler.tryAcquire()) return@refreshRequest
        if (normalizedCommands.isEmpty()) return@refreshRequest
        scope.launch {
            isRefreshing = true
            val sent = normalizedCommands.all { sendAgentCommand(context, it) }
            val messageRes = if (sent) R.string.workflow_refresh_requested else R.string.workflow_refresh_failed
            Toast.makeText(context, context.getString(messageRes), Toast.LENGTH_SHORT).show()
            delay(cooldownMs)
            isRefreshing = false
            if (sent) {
                successfulRefreshCount += 1L
            }
        }
    }

    return WorkflowRefreshUiState(
        isRefreshing = isRefreshing,
        successfulRefreshCount = successfulRefreshCount,
        onRefreshRequest = onRefreshRequest,
    )
}

@Composable
internal fun WorkflowRefreshActionButton(
    refreshState: WorkflowRefreshUiState,
) {
    IconButton(
        onClick = refreshState::requestRefresh,
        enabled = !refreshState.isRefreshing,
    ) {
        if (refreshState.isRefreshing) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
            )
        } else {
            Icon(
                painter = painterResource(R.drawable.ic_tb_refresh),
                contentDescription = stringResource(R.string.common_refresh),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WorkflowRefreshContainer(
    refreshState: WorkflowRefreshUiState,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val pullToRefreshState = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshState.isRefreshing,
        onRefresh = refreshState::requestRefresh,
        modifier = modifier,
        state = pullToRefreshState,
    ) {
        content()
    }
}

@Composable
internal fun rememberTransientHighlight(
    triggerKey: Long,
    durationMs: Long = 1_600L,
): Boolean {
    var highlighted by remember { mutableStateOf(false) }

    LaunchedEffect(triggerKey) {
        if (triggerKey <= 0L) return@LaunchedEffect
        highlighted = true
        delay(durationMs)
        highlighted = false
    }

    return highlighted
}

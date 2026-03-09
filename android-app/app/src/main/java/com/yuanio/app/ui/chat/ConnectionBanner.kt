package com.yuanio.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.ui.theme.LocalYuanioColors

@Composable
fun ConnectionBanner(
    connState: ConnectionState,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val vibeCastColors = LocalYuanioColors.current
    AnimatedVisibility(
        visible = connState != ConnectionState.CONNECTED,
        enter = expandVertically(),
        exit = shrinkVertically(),
        modifier = modifier,
    ) {
        val color = when (connState) {
            ConnectionState.DISCONNECTED -> vibeCastColors.disconnected
            ConnectionState.RECONNECTING -> vibeCastColors.reconnecting
            else -> MaterialTheme.colorScheme.outline
        }
        val text = when (connState) {
            ConnectionState.DISCONNECTED -> stringResource(R.string.connection_disconnected)
            ConnectionState.RECONNECTING -> stringResource(R.string.connection_reconnecting)
            else -> ""
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            tonalElevation = 2.dp,
            color = color.copy(alpha = 0.12f),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(
                        if (connState == ConnectionState.DISCONNECTED) {
                            R.drawable.ic_tb_alert_circle
                        } else {
                            R.drawable.ic_tb_refresh
                        }
                    ),
                    contentDescription = null,
                    tint = color,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodySmall,
                    color = color,
                    modifier = Modifier.weight(1f),
                )
                if (connState == ConnectionState.DISCONNECTED) {
                    TextButton(onClick = onRetry) {
                        Text(stringResource(R.string.common_retry), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

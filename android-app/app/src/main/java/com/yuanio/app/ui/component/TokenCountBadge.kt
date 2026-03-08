package com.yuanio.app.ui.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.util.Locale

@Composable
fun TokenCountBadge(
    totalTokens: Int,
    modifier: Modifier = Modifier,
) {
    if (totalTokens <= 0) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        horizontalArrangement = Arrangement.End,
    ) {
        Text(
            text = formatTokens(totalTokens),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
    }
}

private fun formatTokens(n: Int): String = when {
    n >= 1_000_000 -> String.format(Locale.getDefault(), "%.1fM tokens", n / 1_000_000.0)
    n >= 1_000 -> String.format(Locale.getDefault(), "%.1fk tokens", n / 1_000.0)
    else -> "$n tokens"
}

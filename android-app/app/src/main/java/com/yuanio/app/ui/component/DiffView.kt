package com.yuanio.app.ui.component

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
fun DiffView(path: String, diff: String, action: String, modifier: Modifier = Modifier) {
    DiffViewer(
        path = path,
        diff = diff,
        action = action,
        modifier = modifier,
        initiallyExpanded = true,
        showToggle = false,
    )
}

package com.yuanio.app.ui.screen

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Quake Mode 终端容器
 *
 * 类似 Windows Terminal 的 Quake Mode：
 * - 从屏幕顶部滑入的半屏终端
 * - 占屏幕高度的 40%~60%（可拖拽底部边缘调整）
 * - 下拉手势唤出 / 上划手势收起
 * - 带圆角和阴影效果
 *
 * 使用方式（在 MainActivity 或 NavHost 中）：
 * ```
 * var quakeVisible by remember { mutableStateOf(false) }
 *
 * QuakeModeTerminal(
 *     visible = quakeVisible,
 *     onDismiss = { quakeVisible = false },
 * ) {
 *     // Terminal content here
 *     TerminalScreen(...)
 * }
 * ```
 */
@Composable
fun QuakeModeTerminal(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp
    val defaultHeight = screenHeight * 0.5f
    var heightFraction by remember { mutableFloatStateOf(0.5f) }
    var dragOffset by remember { mutableFloatStateOf(0f) }

    AnimatedVisibility(
        visible = visible,
        enter = slideInVertically(
            initialOffsetY = { -it },
            animationSpec = tween(300),
        ),
        exit = slideOutVertically(
            targetOffsetY = { -it },
            animationSpec = tween(250),
        ),
    ) {
        Box(
            modifier = modifier
                .fillMaxWidth()
                .fillMaxHeight(heightFraction)
                .clip(RoundedCornerShape(bottomStart = 16.dp, bottomEnd = 16.dp))
                .background(MaterialTheme.colorScheme.surface),
        ) {
            // 终端内容
            content()

            // 底部拖拽手柄（调整高度）
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(12.dp)
                    .align(Alignment.BottomCenter)
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onDragEnd = {
                                // 如果拖到很小则收起
                                if (heightFraction < 0.15f) {
                                    onDismiss()
                                    heightFraction = 0.5f
                                }
                            },
                        ) { change, dragAmount ->
                            change.consume()
                            val screenPx = screenHeight.toPx()
                            val delta = dragAmount / screenPx
                            heightFraction = (heightFraction + delta).coerceIn(0.1f, 0.8f)
                        }
                    },
            ) {
                // 拖拽指示条
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.15f)
                        .height(4.dp)
                        .align(Alignment.Center)
                        .clip(RoundedCornerShape(2.dp))
                        .background(MaterialTheme.colorScheme.outlineVariant),
                )
            }
        }
    }
}

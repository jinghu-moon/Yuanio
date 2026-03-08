package com.yuanio.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Pane 分屏方向
 */
enum class SplitDirection { HORIZONTAL, VERTICAL }

/**
 * 单个 Pane 的标识与内容
 */
data class PaneSlot(
    val id: String,
    val isFocused: Boolean = false,
)

/**
 * 终端分屏容器：支持在单个 Tab 内水平或垂直分割为两个 Pane。
 *
 * 类似 Windows Terminal 的 Pane 功能：
 * - 支持水平/垂直分割
 * - 分割线可拖拽调整比例（0.2 ~ 0.8）
 * - 焦点 Pane 显示高亮边框
 *
 * 使用方式：
 * ```
 * TerminalPaneContainer(
 *     direction = SplitDirection.VERTICAL,
 *     pane1 = { modifier -> TerminalPaneContent(mgr1, modifier) },
 *     pane2 = { modifier -> TerminalPaneContent(mgr2, modifier) },
 * )
 * ```
 */
@Composable
fun TerminalPaneContainer(
    direction: SplitDirection,
    initialRatio: Float = 0.5f,
    pane1: @Composable (Modifier) -> Unit,
    pane2: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    var ratio by remember { mutableFloatStateOf(initialRatio.coerceIn(0.2f, 0.8f)) }
    val density = LocalDensity.current
    val dividerThickness = 4.dp

    when (direction) {
        SplitDirection.VERTICAL -> {
            // 上下分割
            Column(modifier.fillMaxSize()) {
                // 上半部分
                Box(Modifier.fillMaxWidth().weight(ratio)) {
                    pane1(Modifier.fillMaxSize())
                }

                // 水平分割线（可拖拽）
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(dividerThickness)
                        .background(MaterialTheme.colorScheme.outlineVariant)
                        .pointerInput(Unit) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                val totalHeight = size.height.toFloat()
                                if (totalHeight > 0) {
                                    val delta = dragAmount.y / with(density) { totalHeight / density.density }
                                    ratio = (ratio + delta * 0.002f).coerceIn(0.2f, 0.8f)
                                }
                            }
                        }
                )

                // 下半部分
                Box(Modifier.fillMaxWidth().weight(1f - ratio)) {
                    pane2(Modifier.fillMaxSize())
                }
            }
        }

        SplitDirection.HORIZONTAL -> {
            // 左右分割
            Row(modifier.fillMaxSize()) {
                // 左半部分
                Box(Modifier.fillMaxHeight().weight(ratio)) {
                    pane1(Modifier.fillMaxSize())
                }

                // 垂直分割线（可拖拽）
                Box(
                    Modifier
                        .fillMaxHeight()
                        .width(dividerThickness)
                        .background(MaterialTheme.colorScheme.outlineVariant)
                        .pointerInput(Unit) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                val totalWidth = size.width.toFloat()
                                if (totalWidth > 0) {
                                    val delta = dragAmount.x / with(density) { totalWidth / density.density }
                                    ratio = (ratio + delta * 0.002f).coerceIn(0.2f, 0.8f)
                                }
                            }
                        }
                )

                // 右半部分
                Box(Modifier.fillMaxHeight().weight(1f - ratio)) {
                    pane2(Modifier.fillMaxSize())
                }
            }
        }
    }
}

/**
 * 单 Pane 模式：不分屏时直接展示内容。
 * 作为 TerminalPaneContainer 的简化替代。
 */
@Composable
fun SinglePane(
    content: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        content(Modifier.fillMaxSize())
    }
}

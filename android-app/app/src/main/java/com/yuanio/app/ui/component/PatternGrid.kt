package com.yuanio.app.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.min

@Composable
fun PatternGrid(
    selectedNodes: List<Int>,
    onPatternChange: (List<Int>) -> Unit,
    onPatternComplete: (List<Int>) -> Unit,
    enabled: Boolean = true,
    error: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    val activeColor = if (error) colors.error else Color(0xFF0070F3)
    var dragPoint by remember { mutableStateOf<Offset?>(null) }
    var gestureNodes by remember { mutableStateOf(selectedNodes) }

    LaunchedEffect(selectedNodes) {
        gestureNodes = selectedNodes
    }

    Surface(
        shape = RoundedCornerShape(24.dp),
        color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.7f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier
                .padding(20.dp)
                .pointerInput(enabled) {
                    detectDragGestures(
                        onDragStart = { start ->
                            if (!enabled) return@detectDragGestures
                            val centers = calculateCenters(size.width.toFloat(), size.height.toFloat())
                            val threshold = min(size.width, size.height) / 6.2f
                            val first = hitNode(start, centers, threshold)
                            gestureNodes = if (first != null) listOf(first) else emptyList()
                            onPatternChange(gestureNodes)
                            dragPoint = start
                        },
                        onDrag = { change, _ ->
                            if (!enabled) return@detectDragGestures
                            val point = change.position
                            dragPoint = point

                            val centers = calculateCenters(size.width.toFloat(), size.height.toFloat())
                            val threshold = min(size.width, size.height) / 6.2f
                            val next = hitNode(point, centers, threshold)
                            if (next != null && next !in gestureNodes) {
                                gestureNodes = gestureNodes + next
                                onPatternChange(gestureNodes)
                            }
                        },
                        onDragEnd = {
                            if (!enabled) return@detectDragGestures
                            val completed = gestureNodes
                            dragPoint = null
                            if (completed.size >= 4) onPatternComplete(completed)
                            else onPatternComplete(emptyList())
                            gestureNodes = emptyList()
                            onPatternChange(emptyList())
                        },
                        onDragCancel = {
                            dragPoint = null
                            gestureNodes = emptyList()
                            onPatternChange(emptyList())
                        }
                    )
                }
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
            ) {
                val centers = calculateCenters(size.width, size.height)
                val nodeRadius = min(size.width, size.height) / 18f
                val haloRadius = nodeRadius * 1.9f

                if (gestureNodes.size >= 2) {
                    for (i in 0 until gestureNodes.lastIndex) {
                        val from = centers[gestureNodes[i]]
                        val to = centers[gestureNodes[i + 1]]
                        drawLine(
                            color = activeColor,
                            start = from,
                            end = to,
                            strokeWidth = 7f,
                            cap = StrokeCap.Round,
                        )
                    }
                }

                if (gestureNodes.isNotEmpty() && dragPoint != null) {
                    drawLine(
                        color = activeColor.copy(alpha = 0.65f),
                        start = centers[gestureNodes.last()],
                        end = dragPoint!!,
                        strokeWidth = 6f,
                        cap = StrokeCap.Round,
                    )
                }

                centers.forEachIndexed { index, center ->
                    val selected = index in gestureNodes
                    if (selected) {
                        drawCircle(
                            color = activeColor.copy(alpha = 0.22f),
                            radius = haloRadius,
                            center = center,
                        )
                    }
                    if (selected) {
                        drawCircle(
                            color = activeColor,
                            radius = nodeRadius,
                            center = center,
                        )
                    } else {
                        drawCircle(
                            color = colors.outline.copy(alpha = 0.55f),
                            radius = nodeRadius * 0.82f,
                            center = center,
                            style = Stroke(width = 2.5f),
                        )
                    }
                }
            }
        }
    }
}

private fun calculateCenters(width: Float, height: Float): List<Offset> {
    val cellW = width / 3f
    val cellH = height / 3f
    val list = ArrayList<Offset>(9)
    for (row in 0 until 3) {
        for (col in 0 until 3) {
            list.add(
                Offset(
                    x = cellW * (col + 0.5f),
                    y = cellH * (row + 0.5f),
                )
            )
        }
    }
    return list
}

private fun hitNode(point: Offset, centers: List<Offset>, threshold: Float): Int? {
    var candidate: Int? = null
    var minDist = Float.MAX_VALUE
    centers.forEachIndexed { index, center ->
        val dx = point.x - center.x
        val dy = point.y - center.y
        val dist = dx * dx + dy * dy
        if (dist < threshold * threshold && dist < minDist) {
            minDist = dist
            candidate = index
        }
    }
    return candidate
}

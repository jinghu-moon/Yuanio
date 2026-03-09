package com.yuanio.app.ui.component

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import kotlinx.coroutines.delay

@Composable
fun PinKeypad(
    pinLength: Int = 4,
    pin: String,
    onPinChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    enabled: Boolean = true,
    error: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    val shakeOffset = remember { Animatable(0f) }

    LaunchedEffect(error) {
        if (!error) return@LaunchedEffect
        shakeOffset.snapTo(0f)
        shakeOffset.animateTo(
            targetValue = 0f,
            animationSpec = keyframes {
                durationMillis = 400
                -12f at 60
                12f at 140
                -8f at 220
                8f at 300
                0f at 400
            }
        )
    }

    LaunchedEffect(pin, enabled) {
        if (!enabled) return@LaunchedEffect
        if (pin.length == pinLength) {
            delay(200)
            onSubmit(pin)
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(
            modifier = Modifier
                .offset { IntOffset(shakeOffset.value.dp.roundToPx(), 0) }
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            repeat(pinLength) { index ->
                val filled = index < pin.length
                val dotColor = when {
                    error -> colors.error
                    filled -> colors.onSurface
                    else -> Color.Transparent
                }
                val border = if (filled) null else BorderStroke(1.dp, colors.outlineVariant)
                Surface(
                    modifier = Modifier.size(12.dp),
                    shape = CircleShape,
                    color = dotColor,
                    border = border,
                ) {}
            }
        }

        Spacer(Modifier.height(16.dp))

        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("", "0", "<"),
        )

        rows.forEach { row ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.padding(vertical = 7.dp)
            ) {
                row.forEach { key ->
                    when (key) {
                        "" -> Spacer(Modifier.size(72.dp))
                        "<" -> {
                            KeyButton(enabled = enabled && pin.isNotEmpty(), onClick = {
                                if (pin.isNotEmpty()) onPinChange(pin.dropLast(1))
                            }) {
                                Icon(
                                    painter = painterResource(R.drawable.ic_tb_backspace),
                                    contentDescription = stringResource(R.string.common_delete),
                                    tint = colors.onSurface,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                        else -> {
                            KeyButton(enabled = enabled && pin.length < pinLength, onClick = {
                                if (pin.length < pinLength) onPinChange(pin + key)
                            }) {
                                Text(
                                    text = key,
                                    style = MaterialTheme.typography.headlineMedium,
                                    fontWeight = FontWeight.Medium,
                                    color = colors.onSurface
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun KeyButton(
    enabled: Boolean,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val bg = if (enabled) colors.surface else colors.surfaceVariant.copy(alpha = 0.4f)

    Surface(
        shape = CircleShape,
        color = bg,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.7f)),
        modifier = Modifier
            .size(72.dp)
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .background(Color.Transparent),
            contentAlignment = Alignment.Center
        ) {
            content()
        }
    }
}

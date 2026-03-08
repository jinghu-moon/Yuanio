package com.yuanio.app.ui.screen

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.ui.component.PinKeypad
import com.yuanio.app.ui.component.PatternGrid

enum class UnlockMode {
    PASSWORD,
    PIN,
    PATTERN,
}

private enum class PasswordInputMode {
    PIN_PAD,
    KEYBOARD,
}

@Composable
fun UnlockScreen(
    primaryMode: UnlockMode,
    biometricEnabled: Boolean,
    failedAttempts: Int,
    lockoutRemainingMs: Long,
    statusMessage: String?,
    inProgress: Boolean,
    onPasswordSubmit: (String) -> Unit,
    onPatternSubmit: (List<Int>) -> Unit,
    onBiometricRequest: () -> Unit,
    onExit: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    var password by remember { mutableStateOf("") }
    var passwordPin by remember { mutableStateOf("") }
    var passwordInputMode by remember { mutableStateOf(PasswordInputMode.PIN_PAD) }
    var pin by remember { mutableStateOf("") }
    var pattern by remember { mutableStateOf<List<Int>>(emptyList()) }

    val lockSeconds = (lockoutRemainingMs / 1000L).coerceAtLeast(0L)
    val isError = !statusMessage.isNullOrBlank() && (
        statusMessage.contains("失败") ||
            statusMessage.contains("错误") ||
            statusMessage.contains("不正确")
        )
    val message = when {
        lockoutRemainingMs > 0L -> stringResource(R.string.unlock_lockout_countdown, lockSeconds)
        !statusMessage.isNullOrBlank() -> statusMessage
        inProgress -> stringResource(R.string.unlock_message_verifying)
        else -> stringResource(R.string.unlock_message_hint)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(horizontal = 22.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            shape = CircleShape,
            color = colors.surface,
            border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_ms_lock),
                contentDescription = null,
                tint = colors.onSurface,
                modifier = Modifier
                    .size(52.dp)
                    .padding(12.dp)
            )
        }

        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.SemiBold,
            color = colors.onBackground
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = when (primaryMode) {
                UnlockMode.PATTERN -> stringResource(R.string.unlock_mode_pattern)
                UnlockMode.PIN -> stringResource(R.string.unlock_mode_pin)
                UnlockMode.PASSWORD -> stringResource(R.string.unlock_mode_password)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = colors.outline
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = if (isError || lockoutRemainingMs > 0L) colors.error else colors.outline,
        )

        if (failedAttempts > 0) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = pluralStringResource(
                    R.plurals.unlock_failed_attempts,
                    failedAttempts,
                    failedAttempts
                ),
                style = MaterialTheme.typography.labelSmall,
                color = colors.outline,
            )
        }

        Spacer(Modifier.height(22.dp))

        when (primaryMode) {
            UnlockMode.PASSWORD -> {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { passwordInputMode = PasswordInputMode.PIN_PAD },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            border = if (passwordInputMode == PasswordInputMode.PIN_PAD) {
                                BorderStroke(1.dp, colors.primary)
                            } else {
                                BorderStroke(1.dp, colors.outlineVariant)
                            },
                        ) {
                            Text(stringResource(R.string.unlock_password_input_pinpad))
                        }
                        OutlinedButton(
                            onClick = { passwordInputMode = PasswordInputMode.KEYBOARD },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            border = if (passwordInputMode == PasswordInputMode.KEYBOARD) {
                                BorderStroke(1.dp, colors.primary)
                            } else {
                                BorderStroke(1.dp, colors.outlineVariant)
                            },
                        ) {
                            Text(stringResource(R.string.unlock_password_input_keyboard))
                        }
                    }

                    if (passwordInputMode == PasswordInputMode.PIN_PAD) {
                        PinKeypad(
                            pinLength = 6,
                            pin = passwordPin,
                            onPinChange = { passwordPin = it },
                            onSubmit = { value ->
                                if (lockoutRemainingMs <= 0L) {
                                    onPasswordSubmit(value)
                                }
                                passwordPin = ""
                            },
                            enabled = !inProgress && lockoutRemainingMs <= 0L,
                            error = isError,
                        )
                    } else {
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text(stringResource(R.string.unlock_password_label)) },
                            placeholder = { Text(stringResource(R.string.unlock_password_placeholder)) },
                            enabled = !inProgress && lockoutRemainingMs <= 0L,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            isError = isError,
                        )
                        Text(
                            text = stringResource(R.string.unlock_password_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.outline
                        )
                    }
                }
            }

            UnlockMode.PIN -> {
                PinKeypad(
                    pinLength = 6,
                    pin = pin,
                    onPinChange = { pin = it },
                    onSubmit = { value ->
                        if (lockoutRemainingMs <= 0L) {
                            onPasswordSubmit(value)
                        }
                        pin = ""
                    },
                    enabled = !inProgress && lockoutRemainingMs <= 0L,
                    error = isError,
                )
            }

            UnlockMode.PATTERN -> {
                PatternGrid(
                    selectedNodes = pattern,
                    onPatternChange = { pattern = it },
                    onPatternComplete = { nodes ->
                        if (nodes.size >= 4 && lockoutRemainingMs <= 0L) onPatternSubmit(nodes)
                        pattern = emptyList()
                    },
                    enabled = !inProgress && lockoutRemainingMs <= 0L,
                    error = isError,
                )
            }
        }

        if (biometricEnabled) {
            Spacer(Modifier.height(14.dp))
            OutlinedButton(
                onClick = onBiometricRequest,
                enabled = !inProgress && lockoutRemainingMs <= 0L,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_ms_fingerprint),
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.size(8.dp))
                Text(stringResource(R.string.unlock_use_fingerprint))
            }
        }

        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onExit, enabled = !inProgress) {
                Text(stringResource(R.string.common_exit))
            }
            Spacer(Modifier.weight(1f))
            if (primaryMode == UnlockMode.PASSWORD && passwordInputMode == PasswordInputMode.KEYBOARD) {
                Button(
                    onClick = {
                        if (password.isNotBlank() && lockoutRemainingMs <= 0L) {
                            onPasswordSubmit(password)
                            password = ""
                        }
                    },
                    enabled = !inProgress && lockoutRemainingMs <= 0L,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(stringResource(R.string.common_unlock))
                }
            }
        }
    }
}

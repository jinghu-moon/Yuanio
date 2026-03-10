package sy.yuanio.app.ui.screen

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R
import sy.yuanio.app.crypto.KeyDerivation
import sy.yuanio.app.crypto.VaultManager
import sy.yuanio.app.ui.component.PatternGrid
import androidx.compose.material3.Icon

enum class SetupStep {
    CHOOSE_TYPE,
    ENTER_CREDENTIAL,
    CONFIRM_CREDENTIAL,
    ENABLE_BIOMETRIC,
}

@Composable
fun VaultSetupScreen(
    biometricAvailable: Boolean,
    isMigration: Boolean,
    inProgress: Boolean,
    errorMessage: String?,
    onSetup: (credential: String, type: VaultManager.CredentialType, enableBiometric: Boolean) -> Unit,
    onCancel: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val errorConfirmMismatch = stringResource(R.string.vault_setup_error_confirm_mismatch)
    val errorPatternMin = stringResource(R.string.vault_setup_error_pattern_min)

    var step by remember { mutableStateOf(SetupStep.CHOOSE_TYPE) }
    var type by remember { mutableStateOf(VaultManager.CredentialType.PASSWORD) }
    var firstCredential by remember { mutableStateOf<String?>(null) }
    var passwordInput by remember { mutableStateOf("") }
    var patternInput by remember { mutableStateOf<List<Int>>(emptyList()) }
    var localError by remember { mutableStateOf<String?>(null) }
    var enableBiometric by remember { mutableStateOf(biometricAvailable) }

    fun resetInput() {
        passwordInput = ""
        patternInput = emptyList()
    }

    fun submitCredential(raw: String) {
        if (raw.isBlank()) return
        if (step == SetupStep.ENTER_CREDENTIAL) {
            firstCredential = raw
            localError = null
            step = SetupStep.CONFIRM_CREDENTIAL
            resetInput()
            return
        }

        if (step == SetupStep.CONFIRM_CREDENTIAL) {
            if (raw != firstCredential) {
                localError = errorConfirmMismatch
                resetInput()
                return
            }

            if (biometricAvailable) {
                step = SetupStep.ENABLE_BIOMETRIC
                localError = null
            } else {
                onSetup(raw, type, false)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(horizontal = 20.dp, vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            shape = CircleShape,
            color = colors.surface,
            border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_lock),
                contentDescription = null,
                modifier = Modifier
                    .size(50.dp)
                    .padding(11.dp),
                tint = colors.onSurface
            )
        }

        Spacer(Modifier.height(16.dp))
        Text(
            text = if (isMigration) {
                stringResource(R.string.vault_setup_title_migration)
            } else {
                stringResource(R.string.vault_setup_title)
            },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = colors.onBackground
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = when (step) {
                SetupStep.CHOOSE_TYPE -> stringResource(R.string.vault_setup_step_choose)
                SetupStep.ENTER_CREDENTIAL -> if (type == VaultManager.CredentialType.PATTERN) {
                    stringResource(R.string.vault_setup_step_enter_pattern)
                } else {
                    stringResource(R.string.vault_setup_step_enter_password)
                }

                SetupStep.CONFIRM_CREDENTIAL -> stringResource(R.string.vault_setup_step_confirm)
                SetupStep.ENABLE_BIOMETRIC -> stringResource(R.string.vault_setup_step_biometric)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = colors.outline
        )

        Spacer(Modifier.height(18.dp))

        if (!errorMessage.isNullOrBlank()) {
            Text(errorMessage, color = colors.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
        }

        if (!localError.isNullOrBlank()) {
            Text(localError.orEmpty(), color = colors.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
        }

        when (step) {
            SetupStep.CHOOSE_TYPE -> {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    SetupTypeCard(
                        title = stringResource(R.string.vault_credential_password),
                        subtitle = stringResource(R.string.vault_credential_password_desc),
                        selected = type == VaultManager.CredentialType.PASSWORD,
                        onClick = { type = VaultManager.CredentialType.PASSWORD },
                        modifier = Modifier.weight(1f)
                    )
                    SetupTypeCard(
                        title = stringResource(R.string.vault_credential_pattern),
                        subtitle = stringResource(R.string.vault_credential_pattern_desc),
                        selected = type == VaultManager.CredentialType.PATTERN,
                        onClick = { type = VaultManager.CredentialType.PATTERN },
                        modifier = Modifier.weight(1f)
                    )
                    SetupTypeCard(
                        title = stringResource(R.string.vault_credential_none),
                        subtitle = stringResource(R.string.vault_credential_none_desc),
                        selected = type == VaultManager.CredentialType.NONE,
                        onClick = { type = VaultManager.CredentialType.NONE },
                        modifier = Modifier.weight(1f)
                    )
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        localError = null
                        if (type == VaultManager.CredentialType.NONE) {
                            // NONE 模式也允许提前开启指纹，除非用户后续手动关闭
                            onSetup(VaultManager.NONE_CREDENTIAL, type, biometricAvailable)
                        } else {
                            step = SetupStep.ENTER_CREDENTIAL
                            resetInput()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.common_next))
                }
            }

            SetupStep.ENTER_CREDENTIAL,
            SetupStep.CONFIRM_CREDENTIAL -> {
                if (type == VaultManager.CredentialType.PATTERN) {
                    PatternGrid(
                        selectedNodes = patternInput,
                        onPatternChange = { patternInput = it },
                        onPatternComplete = { nodes ->
                            if (nodes.size >= 4) {
                                submitCredential(KeyDerivation.serializePattern(nodes))
                            } else {
                                localError = errorPatternMin
                            }
                        },
                        error = !localError.isNullOrBlank(),
                        enabled = !inProgress,
                    )
                } else {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedTextField(
                            value = passwordInput,
                            onValueChange = { passwordInput = it; localError = null },
                            label = {
                                Text(
                                    if (step == SetupStep.ENTER_CREDENTIAL) {
                                        stringResource(R.string.vault_setup_password_set)
                                    } else {
                                        stringResource(R.string.vault_setup_password_confirm)
                                    }
                                )
                            },
                            placeholder = { Text(stringResource(R.string.unlock_password_placeholder)) },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !inProgress,
                            isError = !localError.isNullOrBlank(),
                        )
                        Button(
                            onClick = { submitCredential(passwordInput) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !inProgress && passwordInput.isNotBlank()
                        ) {
                            Text(
                                if (step == SetupStep.ENTER_CREDENTIAL) {
                                    stringResource(R.string.common_next)
                                } else {
                                    stringResource(R.string.common_confirm)
                                }
                            )
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
                OutlinedButton(
                    onClick = {
                        localError = null
                        step = SetupStep.CHOOSE_TYPE
                        firstCredential = null
                        resetInput()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !inProgress,
                ) {
                    Text(stringResource(R.string.common_back))
                }
            }

            SetupStep.ENABLE_BIOMETRIC -> {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = colors.surface,
                    border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.65f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 14.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.vault_setup_enable_fingerprint),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = colors.onSurface
                                )
                                Text(
                                    text = stringResource(R.string.vault_setup_enable_fingerprint_desc),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.outline
                                )
                            }
                            Switch(
                                checked = enableBiometric,
                                onCheckedChange = { enableBiometric = it },
                                enabled = !inProgress,
                            )
                        }

                        Spacer(Modifier.height(14.dp))
                        Button(
                            onClick = {
                                val credential = firstCredential ?: return@Button
                                onSetup(credential, type, enableBiometric)
                            },
                            enabled = !inProgress,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            if (inProgress) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = colors.onPrimary
                                )
                            } else {
                                Text(stringResource(R.string.common_done))
                            }
                        }
                    }
                }

                if (!inProgress) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            step = SetupStep.CONFIRM_CREDENTIAL
                            localError = null
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.vault_setup_back_previous))
                    }
                }
            }
        }

        Spacer(Modifier.weight(1f))
        TextButton(onClick = onCancel, enabled = !inProgress) {
            Text(stringResource(R.string.common_exit))
        }
    }
}

@Composable
private fun SetupTypeCard(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = if (selected) colors.surface else colors.surface,
        border = BorderStroke(
            1.dp,
            if (selected) colors.primary else colors.outlineVariant.copy(alpha = 0.7f)
        ),
        modifier = modifier.clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 18.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.onSurface
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.outline
                )
            }
        }
    }
}


package com.yuanio.app.ui.screen

import android.app.Application
import android.content.ClipData
import android.view.WindowManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yuanio.app.R
import com.yuanio.app.crypto.VaultManager
import com.yuanio.app.data.ChatHistory
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.NotificationPrefs
import com.yuanio.app.data.TerminalPrefs
import com.yuanio.app.data.TerminalProfile
import com.yuanio.app.data.QuickCommand
import com.yuanio.app.data.TerminalTheme
import com.yuanio.app.ui.theme.ThemeMode
import com.yuanio.app.ui.theme.ThemePreference
import com.yuanio.app.ui.component.BrandChipRow
import com.yuanio.app.data.TtsPrefs
import com.yuanio.app.data.ConnectionMode
import com.yuanio.app.data.FeaturePrefs
import com.yuanio.app.data.LocalConnectionPrefs
import com.yuanio.app.data.ImIntegrationPrefs
import com.yuanio.app.data.ImPlatform
import com.yuanio.app.data.WebhookEvent
import com.yuanio.app.ui.theme.AppLanguage
import com.yuanio.app.ui.theme.LanguagePreference
import kotlin.math.roundToInt

class SettingsViewModel(app: Application) : AndroidViewModel(app) {
    val keyStore = KeyStore(app)
    val history = ChatHistory(app)

    val profiles: Set<String> get() = keyStore.profileNames()
    val activeProfile: String get() = keyStore.activeProfile
    val vaultConfigured: Boolean get() = keyStore.isVaultConfigured
    val vaultCredentialType: VaultManager.CredentialType get() = keyStore.vaultCredentialType
    val vaultBiometricEnabled: Boolean get() = keyStore.vaultBiometricEnabled
    val vaultAutoLockTimeoutMs: Long get() = keyStore.vaultAutoLockTimeoutMs

    fun switchProfile(name: String) { keyStore.activeProfile = name }
    fun clearHistory() { /* ChatHistory 目前无 clearAll，按 session 清除 */
        keyStore.sessionId?.let { history.save(it, emptyList()) }
    }
    fun unpair() { keyStore.unpair() }
    fun setVaultAutoLockTimeout(timeoutMs: Long) { keyStore.vaultAutoLockTimeoutMs = timeoutMs }
    fun setVaultBiometric(enabled: Boolean, credential: String?): Boolean {
        return keyStore.setVaultBiometric(enabled, credential)
    }
    fun changeVaultCredential(
        oldCredential: String,
        newCredential: String,
        newType: VaultManager.CredentialType,
    ): Boolean {
        return keyStore.changeVaultCredential(oldCredential, newCredential, newType)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onUnpaired: () -> Unit,
    vm: SettingsViewModel = viewModel()
) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    var showUnpairDialog by remember { mutableStateOf(false) }
    var screenshotProtection by remember { mutableStateOf(true) }

    val themeMode by ThemePreference.mode.collectAsStateWithLifecycle()
    val appLanguage by LanguagePreference.language.collectAsStateWithLifecycle()
    var agentNotif by remember { mutableStateOf(NotificationPrefs.agentEnabled) }
    var approvalNotif by remember { mutableStateOf(NotificationPrefs.approvalEnabled) }
    var errorNotif by remember { mutableStateOf(NotificationPrefs.errorEnabled) }
    var toolNotif by remember { mutableStateOf(NotificationPrefs.toolEnabled) }
    var approvalAutoRejectEnabled by remember { mutableStateOf(FeaturePrefs.approvalAutoRejectEnabled) }
    var chatSplitPaneEnabled by remember { mutableStateOf(FeaturePrefs.chatSplitPaneEnabled) }
    var terminalProfiles by remember { mutableStateOf(TerminalPrefs.getProfiles()) }
    var activeTerminalProfileId by remember { mutableStateOf(TerminalPrefs.activeProfileId) }
    var terminalMaxTabs by remember { mutableIntStateOf(TerminalPrefs.maxTabs) }
    var terminalShortcuts by remember { mutableStateOf(TerminalPrefs.getProfileShortcuts()) }
    var quickCommands by remember { mutableStateOf(TerminalPrefs.getQuickCommands()) }
    var profileToEdit by remember { mutableStateOf<TerminalProfile?>(null) }
    var profileSeed by remember { mutableStateOf<TerminalProfile?>(null) }
    var profileToDelete by remember { mutableStateOf<TerminalProfile?>(null) }
    var quickCommandToEdit by remember { mutableStateOf<QuickCommand?>(null) }
    var quickCommandSeed by remember { mutableStateOf<QuickCommand?>(null) }
    var quickCommandToDelete by remember { mutableStateOf<QuickCommand?>(null) }
    var shortcutSlotToEdit by remember { mutableStateOf<Int?>(null) }
    var showExportDialog by remember { mutableStateOf(false) }
    var showImportDialog by remember { mutableStateOf(false) }
    var importReplace by remember { mutableStateOf(false) }
    var importText by remember { mutableStateOf("") }
    var importError by remember { mutableStateOf<String?>(null) }
    var vaultAutoLockTimeout by remember { mutableLongStateOf(vm.vaultAutoLockTimeoutMs) }
    var vaultBiometricEnabled by remember { mutableStateOf(vm.vaultBiometricEnabled) }
    var showChangeCredentialDialog by remember { mutableStateOf(false) }
    var showBiometricCredentialDialog by remember { mutableStateOf(false) }
    var securityHint by remember { mutableStateOf<String?>(null) }
    var pendingBiometricValue by remember { mutableStateOf(false) }
    val securityAutoLockUpdatedText = stringResource(R.string.settings_security_auto_lock_updated)
    val securityFingerprintDisabledText = stringResource(R.string.settings_security_fingerprint_disabled)
    val securityDisableFailedText = stringResource(R.string.settings_security_disable_failed)
    val securityFingerprintEnabledText = stringResource(R.string.settings_security_fingerprint_enabled)
    val securityEnableFailedText = stringResource(R.string.settings_security_enable_failed)
    val securityPasswordUpdatedText = stringResource(R.string.settings_security_password_updated)
    val securityPasswordUpdateFailedText = stringResource(R.string.settings_security_password_update_failed)
    val securityFingerprintVerifyFailedText = stringResource(R.string.settings_security_fingerprint_verify_failed)
    val terminalNewCommandNameText = stringResource(R.string.settings_terminal_new_command_name)
    val terminalUnnamedCommandText = stringResource(R.string.settings_terminal_command_unnamed)
    val terminalImportFailedText = stringResource(R.string.settings_terminal_import_failed)

    fun refreshTerminalProfiles() {
        terminalProfiles = TerminalPrefs.getProfiles()
        activeTerminalProfileId = TerminalPrefs.activeProfileId
        terminalMaxTabs = TerminalPrefs.maxTabs
        terminalShortcuts = TerminalPrefs.getProfileShortcuts()
        quickCommands = TerminalPrefs.getQuickCommands()
    }

    LaunchedEffect(Unit) { refreshTerminalProfiles() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(stringResource(R.string.settings_title_my)) }
        )
    }) { padding ->
        val activeProfile = vm.activeProfile
        val profiles = vm.profiles.toList().sorted()
        val serverUrl = vm.keyStore.serverUrl ?: stringResource(R.string.settings_value_unconfigured)
        val deviceId = vm.keyStore.deviceId ?: stringResource(R.string.settings_value_unpaired)
        val sessionId = vm.keyStore.sessionId ?: stringResource(R.string.settings_value_unpaired)

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                SectionCard(title = stringResource(R.string.settings_section_project)) {
                    InfoRow(label = stringResource(R.string.settings_label_current_project), value = activeProfile)
                    if (profiles.size > 1) {
                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(R.string.settings_action_switch_project), style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(4.dp))
                        profiles.forEach { name ->
                            ActionRow(
                                title = name,
                                subtitle = if (name == activeProfile) {
                                    stringResource(R.string.settings_state_current)
                                } else {
                                    null
                                },
                                onClick = { vm.switchProfile(name) },
                                tone = if (name == activeProfile) MaterialTheme.colorScheme.primary else null
                            )
                        }
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_connection_info)) {
                    InfoRow(label = stringResource(R.string.settings_label_server_url), value = serverUrl)
                    InfoRow(label = stringResource(R.string.settings_label_device_id), value = deviceId)
                    InfoRow(label = stringResource(R.string.settings_label_session_id), value = sessionId)
                }
            }

            item {
                var connMode by remember { mutableStateOf(LocalConnectionPrefs.mode) }
                var manualIp by remember { mutableStateOf(LocalConnectionPrefs.manualIp) }
                var manualPort by remember { mutableStateOf(LocalConnectionPrefs.manualPort.toString()) }

                SectionCard(title = stringResource(R.string.settings_section_connection_mode)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ConnectionMode.entries.forEach { mode ->
                            FilterChip(
                                selected = connMode == mode,
                                onClick = {
                                    connMode = mode
                                    LocalConnectionPrefs.mode = mode
                                },
                                label = { Text(stringResource(mode.labelRes)) }
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = manualIp,
                        onValueChange = { manualIp = it; LocalConnectionPrefs.manualIp = it },
                        label = { Text(stringResource(R.string.settings_label_agent_ip)) },
                        singleLine = true,
                        supportingText = { Text(stringResource(R.string.settings_hint_agent_ip)) },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(4.dp))
                    OutlinedTextField(
                        value = manualPort,
                        onValueChange = { v ->
                            manualPort = v
                            v.toIntOrNull()?.let { LocalConnectionPrefs.manualPort = it }
                        },
                        label = { Text(stringResource(R.string.settings_label_port)) },
                        singleLine = true,
                        supportingText = { Text(stringResource(R.string.settings_hint_default_port)) },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        when (connMode) {
                            ConnectionMode.AUTO -> stringResource(R.string.settings_connection_mode_auto_desc)
                            ConnectionMode.RELAY -> stringResource(R.string.settings_connection_mode_relay_desc)
                            ConnectionMode.LOCAL -> stringResource(R.string.settings_connection_mode_local_desc)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_brand)) {
                    Text(
                        stringResource(R.string.common_supported_models),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.outline
                    )
                    Spacer(Modifier.height(8.dp))
                    BrandChipRow()
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_security)) {
                    ToggleRow(
                        title = stringResource(R.string.settings_security_screenshot_protection),
                        desc = stringResource(R.string.settings_security_screenshot_protection_desc),
                        checked = screenshotProtection
                    ) { on ->
                        screenshotProtection = on
                        val activity = context as? android.app.Activity ?: return@ToggleRow
                        if (on) activity.window.setFlags(
                            WindowManager.LayoutParams.FLAG_SECURE,
                            WindowManager.LayoutParams.FLAG_SECURE
                        ) else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }

                    if (vm.vaultConfigured) {
                        Spacer(Modifier.height(12.dp))
                        InfoRow(
                            label = stringResource(R.string.settings_security_primary_unlock_mode),
                            value = when (vm.vaultCredentialType) {
                                VaultManager.CredentialType.PASSWORD -> stringResource(R.string.vault_credential_password)
                                VaultManager.CredentialType.PATTERN -> stringResource(R.string.vault_credential_pattern)
                                VaultManager.CredentialType.NONE -> stringResource(R.string.settings_unlock_mode_none_direct)
                            }
                        )
                        ActionRow(
                            title = stringResource(R.string.settings_security_switch_unlock_mode),
                            subtitle = stringResource(R.string.settings_security_switch_unlock_mode_desc),
                            onClick = { showChangeCredentialDialog = true }
                        )

                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(R.string.settings_security_auto_lock), style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            listOf(
                                0L to stringResource(R.string.settings_security_auto_lock_now),
                                60_000L to stringResource(R.string.settings_security_auto_lock_1m),
                                300_000L to stringResource(R.string.settings_security_auto_lock_5m),
                                -1L to stringResource(R.string.settings_security_auto_lock_never),
                            ).forEach { (value, label) ->
                                FilterChip(
                                    selected = vaultAutoLockTimeout == value,
                                    onClick = {
                                        vaultAutoLockTimeout = value
                                        vm.setVaultAutoLockTimeout(value)
                                        securityHint = securityAutoLockUpdatedText
                                    },
                                    label = { Text(label) }
                                )
                            }
                        }

                        Spacer(Modifier.height(8.dp))
                        ToggleRow(
                            title = stringResource(R.string.settings_security_fingerprint_unlock),
                            desc = stringResource(R.string.settings_security_fingerprint_unlock_desc),
                            checked = vaultBiometricEnabled
                        ) { on ->
                            if (!on) {
                                val ok = vm.setVaultBiometric(false, null)
                                if (ok) {
                                    vaultBiometricEnabled = false
                                    securityHint = securityFingerprintDisabledText
                                } else {
                                    securityHint = securityDisableFailedText
                                }
                            } else {
                                if (vm.vaultCredentialType == VaultManager.CredentialType.NONE) {
                                    val ok = vm.setVaultBiometric(true, VaultManager.NONE_CREDENTIAL)
                                    if (ok) {
                                        vaultBiometricEnabled = true
                                        securityHint = securityFingerprintEnabledText
                                    } else {
                                        securityHint = securityEnableFailedText
                                    }
                                } else {
                                    pendingBiometricValue = true
                                    showBiometricCredentialDialog = true
                                }
                            }
                        }

                        if (!securityHint.isNullOrBlank()) {
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = securityHint.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_language)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        AppLanguage.entries.forEach { language ->
                            val label = when (language) {
                                AppLanguage.SYSTEM -> stringResource(R.string.settings_language_system)
                                AppLanguage.ZH_CN -> stringResource(R.string.settings_language_zh_cn)
                                AppLanguage.EN -> stringResource(R.string.settings_language_en)
                            }
                            FilterChip(
                                selected = appLanguage == language,
                                onClick = { LanguagePreference.set(language) },
                                label = { Text(label) }
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.settings_language_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_theme)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ThemeMode.entries.forEach { mode ->
                            val label = when (mode) {
                                ThemeMode.SYSTEM -> stringResource(R.string.settings_theme_system)
                                ThemeMode.LIGHT -> stringResource(R.string.settings_theme_light)
                                ThemeMode.DARK -> stringResource(R.string.settings_theme_dark)
                            }
                            FilterChip(
                                selected = themeMode == mode,
                                onClick = { ThemePreference.set(mode) },
                                label = { Text(label) }
                            )
                        }
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_terminal)) {
                    val activeProfile = terminalProfiles.firstOrNull { it.id == activeTerminalProfileId }
                        ?: terminalProfiles.firstOrNull()
                    if (activeProfile == null) {
                        Text(stringResource(R.string.settings_terminal_no_profile), color = MaterialTheme.colorScheme.outline)
                    } else {
                        Text(stringResource(R.string.settings_terminal_profile_list), style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(6.dp))
                        terminalProfiles.forEach { profile ->
                            TerminalProfileRow(
                                profile = profile,
                                isActive = profile.id == activeTerminalProfileId,
                                canDelete = terminalProfiles.size > 1,
                                onActivate = {
                                    TerminalPrefs.setActiveProfile(profile.id)
                                    refreshTerminalProfiles()
                                },
                                onEdit = { profileToEdit = profile },
                                onDelete = { profileToDelete = profile }
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        TextButton(onClick = { profileSeed = activeProfile }) {
                            Text(stringResource(R.string.settings_terminal_add_profile))
                        }
                        Spacer(Modifier.height(12.dp))

                        Text(stringResource(R.string.settings_terminal_max_tabs), style = MaterialTheme.typography.labelLarge)
                        Slider(
                            value = terminalMaxTabs.toFloat(),
                            onValueChange = { value ->
                                val v = value.roundToInt().coerceIn(1, 6)
                                terminalMaxTabs = v
                                TerminalPrefs.maxTabs = v
                            },
                            valueRange = 1f..6f,
                            steps = 4
                        )
                        Text(
                            stringResource(R.string.settings_terminal_max_tabs_value, terminalMaxTabs),
                            style = MaterialTheme.typography.bodySmall
                        )
                        Spacer(Modifier.height(12.dp))

                        Text(stringResource(R.string.settings_terminal_quick_commands), style = MaterialTheme.typography.labelLarge)
                        if (quickCommands.isEmpty()) {
                            Text(stringResource(R.string.settings_terminal_quick_commands_empty), color = MaterialTheme.colorScheme.outline)
                        } else {
                            quickCommands.forEach { cmd ->
                                QuickCommandRow(
                                    command = cmd,
                                    onEdit = { quickCommandToEdit = cmd },
                                    onDelete = { quickCommandToDelete = cmd }
                                )
                            }
                        }
                        TextButton(
                            onClick = {
                                quickCommandSeed = TerminalPrefs.createQuickCommand(
                                    name = terminalNewCommandNameText,
                                    command = "",
                                    appendNewline = true
                                )
                            }
                        ) { Text(stringResource(R.string.settings_terminal_add_quick_command)) }
                        Spacer(Modifier.height(12.dp))

                        Text(stringResource(R.string.settings_terminal_profile_shortcuts), style = MaterialTheme.typography.labelLarge)
                        (1..3).forEach { slot ->
                            val profileId = terminalShortcuts[slot]
                            val profileName = terminalProfiles.firstOrNull { it.id == profileId }?.name
                                ?: stringResource(R.string.settings_terminal_profile_not_set)
                            ActionRow(
                                title = stringResource(R.string.settings_terminal_shortcut_title, slot),
                                subtitle = profileName,
                                onClick = { shortcutSlotToEdit = slot }
                            )
                        }
                        Spacer(Modifier.height(12.dp))

                        Text(stringResource(R.string.settings_terminal_profile_import_export), style = MaterialTheme.typography.labelLarge)
                        ActionRow(
                            title = stringResource(R.string.settings_terminal_export_config),
                            subtitle = stringResource(R.string.settings_terminal_export_config_subtitle),
                            onClick = { showExportDialog = true }
                        )
                        ActionRow(
                            title = stringResource(R.string.settings_terminal_import_config),
                            subtitle = stringResource(R.string.settings_terminal_import_config_subtitle),
                            onClick = {
                                importError = null
                                showImportDialog = true
                            }
                        )
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_notification)) {
                    ToggleRow(
                        title = stringResource(R.string.settings_notification_agent_status),
                        desc = stringResource(R.string.settings_notification_agent_status_desc),
                        checked = agentNotif
                    ) { on ->
                        agentNotif = on
                        NotificationPrefs.agentEnabled = on
                    }
                    ToggleRow(
                        title = stringResource(R.string.settings_notification_approval),
                        desc = stringResource(R.string.settings_notification_approval_desc),
                        checked = approvalNotif
                    ) { on ->
                        approvalNotif = on
                        NotificationPrefs.approvalEnabled = on
                    }
                    ToggleRow(
                        title = stringResource(R.string.settings_notification_error),
                        desc = stringResource(R.string.settings_notification_error_desc),
                        checked = errorNotif
                    ) { on ->
                        errorNotif = on
                        NotificationPrefs.errorEnabled = on
                    }
                    ToggleRow(
                        title = stringResource(R.string.settings_notification_tool_calls),
                        desc = stringResource(R.string.settings_notification_tool_calls_desc),
                        checked = toolNotif
                    ) { on ->
                        toolNotif = on
                        NotificationPrefs.toolEnabled = on
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_features)) {
                    ToggleRow(
                        title = stringResource(R.string.settings_feature_approval_auto_reject),
                        desc = stringResource(R.string.settings_feature_approval_auto_reject_desc),
                        checked = approvalAutoRejectEnabled
                    ) { on ->
                        approvalAutoRejectEnabled = on
                        FeaturePrefs.approvalAutoRejectEnabled = on
                    }
                    ToggleRow(
                        title = stringResource(R.string.settings_feature_chat_split_pane),
                        desc = stringResource(R.string.settings_feature_chat_split_pane_desc),
                        checked = chatSplitPaneEnabled
                    ) { on ->
                        chatSplitPaneEnabled = on
                        FeaturePrefs.chatSplitPaneEnabled = on
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_tts)) {
                    var ttsEnabled by remember { mutableStateOf(TtsPrefs.enabled) }
                    var ttsAutoRead by remember { mutableStateOf(TtsPrefs.autoRead) }
                    var ttsSpeechRate by remember { mutableFloatStateOf(TtsPrefs.speechRate) }
                    var ttsPitch by remember { mutableFloatStateOf(TtsPrefs.pitch) }
                    var ttsLanguage by remember { mutableStateOf(TtsPrefs.language) }

                    ToggleRow(
                        title = stringResource(R.string.settings_tts_enable),
                        desc = stringResource(R.string.settings_tts_enable_desc),
                        checked = ttsEnabled
                    ) {
                        ttsEnabled = it; TtsPrefs.enabled = it
                    }
                    ToggleRow(
                        title = stringResource(R.string.settings_tts_auto_read),
                        desc = stringResource(R.string.settings_tts_auto_read_desc),
                        checked = ttsAutoRead
                    ) {
                        ttsAutoRead = it; TtsPrefs.autoRead = it
                    }

                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.settings_tts_speech_rate, "%.1f".format(ttsSpeechRate)),
                        style = MaterialTheme.typography.labelLarge
                    )
                    Slider(
                        value = ttsSpeechRate,
                        onValueChange = { v ->
                            val r = (v * 10).roundToInt() / 10f
                            ttsSpeechRate = r; TtsPrefs.speechRate = r
                        },
                        valueRange = 0.5f..2.0f
                    )

                    Text(
                        stringResource(R.string.settings_tts_pitch, "%.1f".format(ttsPitch)),
                        style = MaterialTheme.typography.labelLarge
                    )
                    Slider(
                        value = ttsPitch,
                        onValueChange = { v ->
                            val p = (v * 10).roundToInt() / 10f
                            ttsPitch = p; TtsPrefs.pitch = p
                        },
                        valueRange = 0.5f..2.0f
                    )

                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.settings_tts_language), style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            "zh-CN" to stringResource(R.string.settings_tts_lang_zh_cn),
                            "en-US" to stringResource(R.string.settings_tts_lang_en_us),
                            "ja-JP" to stringResource(R.string.settings_tts_lang_ja_jp)
                        ).forEach { (code, label) ->
                            FilterChip(
                                selected = ttsLanguage == code,
                                onClick = { ttsLanguage = code; TtsPrefs.language = code },
                                label = { Text(label) }
                            )
                        }
                    }
                }
            }

            item {
                var imPlatform by remember { mutableStateOf(ImIntegrationPrefs.platform) }
                var webhookUrl by remember { mutableStateOf(ImIntegrationPrefs.webhookUrl) }
                var eventStates by remember {
                    mutableStateOf(WebhookEvent.entries.associateWith { ImIntegrationPrefs.isEventEnabled(it) })
                }

                SectionCard(title = stringResource(R.string.settings_section_im)) {
                    Text(stringResource(R.string.settings_im_platform), style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.height(4.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ImPlatform.entries.forEach { p ->
                            FilterChip(
                                selected = imPlatform == p,
                                onClick = {
                                    imPlatform = p
                                    ImIntegrationPrefs.platform = p
                                },
                                label = { Text(stringResource(p.labelRes)) }
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = webhookUrl,
                        onValueChange = { webhookUrl = it; ImIntegrationPrefs.webhookUrl = it },
                        label = { Text(stringResource(R.string.settings_im_webhook_label)) },
                        singleLine = true,
                        supportingText = { Text(stringResource(R.string.settings_im_webhook_hint, stringResource(imPlatform.labelRes))) },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.settings_im_events), style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.height(4.dp))
                    WebhookEvent.entries.forEach { event ->
                        ToggleRow(
                            title = stringResource(event.labelRes),
                            desc = stringResource(event.descRes),
                            checked = eventStates[event] ?: true
                        ) { on ->
                            ImIntegrationPrefs.toggleEvent(event, on)
                            eventStates = eventStates.toMutableMap().apply { put(event, on) }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        stringResource(R.string.settings_im_sync_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_data)) {
                    ActionRow(
                        title = stringResource(R.string.settings_data_clear_chat_history),
                        subtitle = stringResource(R.string.settings_data_clear_chat_history_desc),
                        onClick = { vm.clearHistory() }
                    )
                }
            }

            item {
                SectionCard(title = stringResource(R.string.settings_section_account)) {
                    ActionRow(
                        title = stringResource(R.string.settings_account_unpair),
                        subtitle = stringResource(R.string.settings_account_unpair_desc),
                        onClick = { showUnpairDialog = true },
                        tone = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }

    if (showUnpairDialog) {
        AlertDialog(
            onDismissRequest = { showUnpairDialog = false },
            title = { Text(stringResource(R.string.settings_unpair_confirm_title)) },
            text = { Text(stringResource(R.string.settings_unpair_confirm_message)) },
            confirmButton = {
                TextButton(onClick = { vm.unpair(); showUnpairDialog = false; onUnpaired() }) {
                    Text(stringResource(R.string.common_confirm), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { showUnpairDialog = false }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }

    if (showChangeCredentialDialog) {
        ChangeVaultCredentialDialog(
            currentType = vm.vaultCredentialType,
            onDismiss = { showChangeCredentialDialog = false },
            onConfirm = { oldCredential, newCredential, newType ->
                val ok = vm.changeVaultCredential(oldCredential, newCredential, newType)
                showChangeCredentialDialog = false
                securityHint = if (ok) {
                    securityPasswordUpdatedText
                } else {
                    securityPasswordUpdateFailedText
                }
            }
        )
    }

    if (showBiometricCredentialDialog) {
        VaultCredentialDialog(
            title = stringResource(R.string.settings_security_fingerprint_enable_title),
            subtitle = stringResource(R.string.settings_security_fingerprint_enable_subtitle),
            onDismiss = { showBiometricCredentialDialog = false },
            onConfirm = { credential ->
                val ok = vm.setVaultBiometric(pendingBiometricValue, credential)
                showBiometricCredentialDialog = false
                if (ok) {
                    vaultBiometricEnabled = pendingBiometricValue
                    securityHint = securityFingerprintEnabledText
                } else {
                    securityHint = securityFingerprintVerifyFailedText
                }
            }
        )
    }

    profileSeed?.let { seed ->
        TerminalProfileDialog(
            title = stringResource(R.string.settings_terminal_dialog_add_profile_title),
            initial = seed,
            onDismiss = { profileSeed = null },
            onSave = { name, shell, cwd, fontSize, scrollback, theme ->
                val profile = TerminalPrefs.createProfile(name, shell, cwd, fontSize, scrollback, theme)
                TerminalPrefs.addProfile(profile, setActive = true)
                refreshTerminalProfiles()
                profileSeed = null
            }
        )
    }

    profileToEdit?.let { profile ->
        TerminalProfileDialog(
            title = stringResource(R.string.settings_terminal_dialog_edit_profile_title),
            initial = profile,
            onDismiss = { profileToEdit = null },
            onSave = { name, shell, cwd, fontSize, scrollback, theme ->
                TerminalPrefs.updateProfile(
                    profile.copy(
                        name = name.trim(),
                        shell = shell.trim(),
                        cwd = cwd.trim(),
                        fontSize = fontSize,
                        scrollback = scrollback,
                        theme = theme
                    )
                )
                refreshTerminalProfiles()
                profileToEdit = null
            }
        )
    }

    profileToDelete?.let { profile ->
        AlertDialog(
            onDismissRequest = { profileToDelete = null },
            title = { Text(stringResource(R.string.settings_terminal_delete_profile_title)) },
            text = { Text(stringResource(R.string.settings_terminal_delete_profile_message, profile.name)) },
            confirmButton = {
                TextButton(onClick = {
                    TerminalPrefs.removeProfile(profile.id)
                    refreshTerminalProfiles()
                    profileToDelete = null
                }) { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { profileToDelete = null }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }

    quickCommandSeed?.let { seed ->
        QuickCommandDialog(
            title = stringResource(R.string.settings_terminal_dialog_add_command_title),
            initial = seed,
            onDismiss = { quickCommandSeed = null },
            onSave = { name, command, appendNewline ->
                val cmd = TerminalPrefs.createQuickCommand(name, command, appendNewline)
                TerminalPrefs.addQuickCommand(cmd)
                refreshTerminalProfiles()
                quickCommandSeed = null
            }
        )
    }

    quickCommandToEdit?.let { cmd ->
        QuickCommandDialog(
            title = stringResource(R.string.settings_terminal_dialog_edit_command_title),
            initial = cmd,
            onDismiss = { quickCommandToEdit = null },
            onSave = { name, command, appendNewline ->
                TerminalPrefs.updateQuickCommand(
                    cmd.copy(
                        name = name.trim().ifBlank { terminalUnnamedCommandText },
                        command = command,
                        appendNewline = appendNewline
                    )
                )
                refreshTerminalProfiles()
                quickCommandToEdit = null
            }
        )
    }

    quickCommandToDelete?.let { cmd ->
        AlertDialog(
            onDismissRequest = { quickCommandToDelete = null },
            title = { Text(stringResource(R.string.settings_terminal_delete_command_title)) },
            text = { Text(stringResource(R.string.settings_terminal_delete_command_message, cmd.name)) },
            confirmButton = {
                TextButton(onClick = {
                    TerminalPrefs.removeQuickCommand(cmd.id)
                    refreshTerminalProfiles()
                    quickCommandToDelete = null
                }) { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { quickCommandToDelete = null }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }

    shortcutSlotToEdit?.let { slot ->
        ProfileShortcutDialog(
            slot = slot,
            profiles = terminalProfiles,
            currentProfileId = terminalShortcuts[slot],
            onDismiss = { shortcutSlotToEdit = null },
            onSelect = { profileId ->
                TerminalPrefs.setProfileShortcut(slot, profileId)
                refreshTerminalProfiles()
                shortcutSlotToEdit = null
            }
        )
    }

    if (showExportDialog) {
        val exportJson = TerminalPrefs.exportProfilesJson()
        AlertDialog(
            onDismissRequest = { showExportDialog = false },
            title = { Text(stringResource(R.string.settings_terminal_export_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = exportJson,
                        onValueChange = {},
                        label = { Text(stringResource(R.string.settings_terminal_json_label)) },
                        readOnly = true,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp)
                    )
                    Text(
                        stringResource(R.string.settings_terminal_export_dialog_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    clipboard.nativeClipboard.setPrimaryClip(
                        ClipData.newPlainText("terminal-profile", exportJson)
                    )
                    showExportDialog = false
                }) { Text(stringResource(R.string.common_copy)) }
            },
            dismissButton = { TextButton(onClick = { showExportDialog = false }) { Text(stringResource(R.string.common_close)) } }
        )
    }

    if (showImportDialog) {
        AlertDialog(
            onDismissRequest = { showImportDialog = false },
            title = { Text(stringResource(R.string.settings_terminal_import_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = importText,
                        onValueChange = { importText = it; importError = null },
                        label = { Text(stringResource(R.string.settings_terminal_json_label)) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp)
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !importReplace,
                            onClick = { importReplace = false },
                            label = { Text(stringResource(R.string.settings_terminal_import_mode_merge)) }
                        )
                        FilterChip(
                            selected = importReplace,
                            onClick = { importReplace = true },
                            label = { Text(stringResource(R.string.settings_terminal_import_mode_replace)) }
                        )
                    }
                    importError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val result = runCatching { TerminalPrefs.importProfilesJson(importText, importReplace) }
                    result.onSuccess {
                        refreshTerminalProfiles()
                        importText = ""
                        showImportDialog = false
                    }.onFailure {
                        importError = it.message ?: terminalImportFailedText
                    }
                }) { Text(stringResource(R.string.settings_terminal_import_config)) }
            },
            dismissButton = { TextButton(onClick = { showImportDialog = false }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }
}

@Composable
private fun SectionCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ToggleRow(
    title: String,
    desc: String,
    checked: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Switch(checked = checked, onCheckedChange = onToggle)
    }
}

@Composable
private fun ActionRow(
    title: String,
    subtitle: String? = null,
    onClick: () -> Unit,
    tone: androidx.compose.ui.graphics.Color? = null
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 6.dp)
    ) {
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium,
            color = tone ?: MaterialTheme.colorScheme.onSurface
        )
        subtitle?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun TerminalProfileRow(
    profile: TerminalProfile,
    isActive: Boolean,
    canDelete: Boolean,
    onActivate: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                Modifier
                    .weight(1f)
                    .padding(end = 8.dp)
                    .clickable { onActivate() }
            ) {
                Text(
                    profile.name,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                )
                Text(
                    terminalProfileSummary(profile),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                if (isActive) {
                    Text(
                        stringResource(R.string.settings_terminal_profile_active),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onEdit) { Text(stringResource(R.string.common_edit)) }
                TextButton(onClick = onDelete, enabled = canDelete) {
                    Text(
                        stringResource(R.string.common_delete),
                        color = if (canDelete) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline
                    )
                }
            }
        }
    }
}

@Composable
private fun terminalProfileSummary(profile: TerminalProfile): String {
    val shell = profile.shell.ifBlank { stringResource(R.string.settings_terminal_profile_default_shell) }
    val shellName = shell.substringAfterLast('/').substringAfterLast('\\')
    val cwd = profile.cwd.ifBlank { stringResource(R.string.settings_terminal_profile_working_dir) }
    val dirName = cwd.substringAfterLast('/').substringAfterLast('\\')
    return "$shellName · $dirName"
}

@Composable
private fun TerminalProfileDialog(
    title: String,
    initial: TerminalProfile,
    onDismiss: () -> Unit,
    onSave: (String, String, String, Int, Int, TerminalTheme) -> Unit
) {
    var name by remember { mutableStateOf(initial.name) }
    var shell by remember { mutableStateOf(initial.shell) }
    var cwd by remember { mutableStateOf(initial.cwd) }
    var fontSize by remember { mutableIntStateOf(initial.fontSize) }
    var scrollback by remember { mutableIntStateOf(initial.scrollback) }
    var theme by remember { mutableStateOf(initial.theme) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.settings_terminal_dialog_name_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = shell,
                    onValueChange = { shell = it },
                    label = { Text(stringResource(R.string.settings_terminal_profile_shell_label)) },
                    singleLine = true,
                    supportingText = { Text(stringResource(R.string.settings_terminal_profile_shell_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = cwd,
                    onValueChange = { cwd = it },
                    label = { Text(stringResource(R.string.settings_terminal_profile_cwd_label)) },
                    singleLine = true,
                    supportingText = { Text(stringResource(R.string.settings_terminal_profile_cwd_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.settings_terminal_profile_font_size), style = MaterialTheme.typography.labelLarge)
                Slider(
                    value = fontSize.toFloat(),
                    onValueChange = { value ->
                        fontSize = value.roundToInt().coerceIn(10, 22)
                    },
                    valueRange = 10f..22f,
                    steps = 11
                )
                Text(stringResource(R.string.settings_terminal_profile_font_size_value, fontSize), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))

                Text(stringResource(R.string.settings_terminal_profile_scrollback), style = MaterialTheme.typography.labelLarge)
                Slider(
                    value = scrollback.toFloat(),
                    onValueChange = { value ->
                        val v = (value / 500f).roundToInt() * 500
                        scrollback = v.coerceIn(500, 10000)
                    },
                    valueRange = 500f..10000f,
                    steps = 18
                )
                Text(stringResource(R.string.settings_terminal_profile_scrollback_value, scrollback), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))

                Text(stringResource(R.string.settings_terminal_profile_theme), style = MaterialTheme.typography.labelLarge)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = theme == TerminalTheme.DARK,
                        onClick = { theme = TerminalTheme.DARK },
                        label = { Text(stringResource(R.string.settings_terminal_profile_theme_dark)) }
                    )
                    FilterChip(
                        selected = theme == TerminalTheme.LIGHT,
                        onClick = { theme = TerminalTheme.LIGHT },
                        label = { Text(stringResource(R.string.settings_terminal_profile_theme_light)) }
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(name, shell, cwd, fontSize, scrollback, theme) },
                enabled = name.trim().isNotBlank()
            ) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
private fun QuickCommandRow(
    command: QuickCommand,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                Text(command.name, style = MaterialTheme.typography.bodyMedium)
                Text(command.command, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onEdit) { Text(stringResource(R.string.common_edit)) }
                TextButton(onClick = onDelete) {
                    Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
private fun QuickCommandDialog(
    title: String,
    initial: QuickCommand,
    onDismiss: () -> Unit,
    onSave: (String, String, Boolean) -> Unit
) {
    var name by remember { mutableStateOf(initial.name) }
    var command by remember { mutableStateOf(initial.command) }
    var appendNewline by remember { mutableStateOf(initial.appendNewline) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.settings_terminal_dialog_name_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = command,
                    onValueChange = { command = it },
                    label = { Text(stringResource(R.string.settings_terminal_command_body_label)) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp)
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = appendNewline, onCheckedChange = { appendNewline = it })
                    Text(stringResource(R.string.settings_terminal_command_append_newline))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(name, command, appendNewline) },
                enabled = name.trim().isNotBlank() && command.isNotBlank()
            ) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
private fun ProfileShortcutDialog(
    slot: Int,
    profiles: List<TerminalProfile>,
    currentProfileId: String?,
    onDismiss: () -> Unit,
    onSelect: (String?) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_terminal_shortcut_dialog_title, slot)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ActionRow(
                    title = stringResource(R.string.settings_terminal_shortcut_clear_binding),
                    subtitle = stringResource(R.string.settings_terminal_shortcut_clear_binding_desc),
                    onClick = { onSelect(null) }
                )
                profiles.forEach { profile ->
                    ActionRow(
                        title = profile.name,
                        subtitle = if (profile.id == currentProfileId) {
                            stringResource(R.string.settings_terminal_shortcut_current_binding)
                        } else {
                            null
                        },
                        onClick = { onSelect(profile.id) },
                        tone = if (profile.id == currentProfileId) MaterialTheme.colorScheme.primary else null
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_close)) } }
    )
}

@Composable
private fun ChangeVaultCredentialDialog(
    currentType: VaultManager.CredentialType,
    onDismiss: () -> Unit,
    onConfirm: (oldCredential: String, newCredential: String, newType: VaultManager.CredentialType) -> Unit,
) {
    var oldCredential by remember { mutableStateOf("") }
    var newCredential by remember { mutableStateOf("") }
    var confirmCredential by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(currentType) }
    var error by remember { mutableStateOf<String?>(null) }
    val errorFillOldText = stringResource(R.string.settings_security_error_fill_old_password)
    val errorFillNewText = stringResource(R.string.settings_security_error_fill_new_password)
    val errorMismatchText = stringResource(R.string.vault_setup_error_confirm_mismatch)
    val confirmText = stringResource(R.string.common_confirm)
    val cancelText = stringResource(R.string.common_cancel)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_security_switch_unlock_mode)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = selectedType == VaultManager.CredentialType.PASSWORD,
                        onClick = { selectedType = VaultManager.CredentialType.PASSWORD },
                        label = { Text(stringResource(R.string.vault_credential_password)) }
                    )
                    FilterChip(
                        selected = selectedType == VaultManager.CredentialType.PATTERN,
                        onClick = { selectedType = VaultManager.CredentialType.PATTERN },
                        label = { Text(stringResource(R.string.vault_credential_pattern)) }
                    )
                    FilterChip(
                        selected = selectedType == VaultManager.CredentialType.NONE,
                        onClick = { selectedType = VaultManager.CredentialType.NONE },
                        label = { Text(stringResource(R.string.vault_credential_none)) }
                    )
                }
                Text(
                    text = stringResource(R.string.settings_security_switch_unlock_mode_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                OutlinedTextField(
                    value = oldCredential,
                    onValueChange = { oldCredential = it; error = null },
                    label = {
                        Text(
                            when (currentType) {
                                VaultManager.CredentialType.PASSWORD -> stringResource(R.string.settings_security_old_password)
                                VaultManager.CredentialType.PATTERN -> stringResource(R.string.settings_security_old_pattern)
                                VaultManager.CredentialType.NONE -> stringResource(R.string.settings_security_old_password_optional)
                            }
                        )
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (selectedType != VaultManager.CredentialType.NONE) {
                    OutlinedTextField(
                        value = newCredential,
                        onValueChange = { newCredential = it; error = null },
                        label = {
                            Text(
                                when (selectedType) {
                                    VaultManager.CredentialType.PASSWORD -> stringResource(R.string.settings_security_new_password)
                                    VaultManager.CredentialType.PATTERN -> stringResource(R.string.settings_security_new_pattern)
                                    VaultManager.CredentialType.NONE -> stringResource(R.string.settings_security_new_password)
                                }
                            )
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = confirmCredential,
                        onValueChange = { confirmCredential = it; error = null },
                        label = { Text(stringResource(R.string.settings_security_confirm_new_password)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (!error.isNullOrBlank()) {
                    Text(
                        text = error.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val oldEffective = if (currentType == VaultManager.CredentialType.NONE) {
                    VaultManager.NONE_CREDENTIAL
                } else {
                    oldCredential
                }

                if (currentType != VaultManager.CredentialType.NONE && oldEffective.isBlank()) {
                    error = errorFillOldText
                    return@TextButton
                }

                if (selectedType == VaultManager.CredentialType.NONE) {
                    onConfirm(oldEffective, VaultManager.NONE_CREDENTIAL, selectedType)
                    return@TextButton
                }

                if (newCredential.isBlank()) {
                    error = errorFillNewText
                    return@TextButton
                }
                if (newCredential != confirmCredential) {
                    error = errorMismatchText
                    return@TextButton
                }
                onConfirm(oldEffective, newCredential, selectedType)
            }) {
                Text(confirmText)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(cancelText) } }
    )
}

@Composable
private fun VaultCredentialDialog(
    title: String,
    subtitle: String,
    onDismiss: () -> Unit,
    onConfirm: (credential: String) -> Unit,
) {
    var credential by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                OutlinedTextField(
                    value = credential,
                    onValueChange = { credential = it },
                    label = { Text(stringResource(R.string.settings_security_verify_password_or_pattern)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(credential) },
                enabled = credential.isNotBlank(),
            ) { Text(stringResource(R.string.settings_security_verify)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

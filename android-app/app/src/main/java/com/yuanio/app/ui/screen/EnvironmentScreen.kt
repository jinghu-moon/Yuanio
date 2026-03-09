package com.yuanio.app.ui.screen

import android.app.Application
import android.content.ClipData
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R
import com.yuanio.app.YuanioApp
import com.yuanio.app.data.ApiClient
import com.yuanio.app.data.ConnectionMode
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.LocalConnectionPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class EnvironmentViewModel(app: Application) : AndroidViewModel(app) {
    data class UiState(
        val activeProfile: String = "default",
        val serverUrl: String = "-",
        val deviceId: String = "-",
        val sessionId: String = "-",
        val gateway: String = "relay",
        val connected: Boolean = false,
        val mode: ConnectionMode = ConnectionMode.AUTO,
        val manualIp: String = "",
        val manualPort: String = "9394",
        val remoteSessionCount: Int? = null,
        val relayHealthy: Boolean? = null,
        val errorMessage: String? = null,
    )

    private val keyStore = KeyStore(app)
    private val sessionGateway = (app as YuanioApp).sessionGateway

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val snapshot = sessionGateway.snapshot()
        _state.value = UiState(
            activeProfile = keyStore.activeProfile,
            serverUrl = keyStore.serverUrl ?: "-",
            deviceId = keyStore.deviceId ?: "-",
            sessionId = keyStore.sessionId ?: "-",
            gateway = snapshot.connectionType,
            connected = snapshot.isConnected,
            mode = LocalConnectionPrefs.mode,
            manualIp = LocalConnectionPrefs.manualIp,
            manualPort = LocalConnectionPrefs.manualPort.toString(),
        )

        val serverUrl = keyStore.serverUrl
        val token = keyStore.sessionToken
        if (serverUrl.isNullOrBlank() || token.isNullOrBlank()) return

        viewModelScope.launch(Dispatchers.IO) {
            runCatching { ApiClient(serverUrl).fetchSessionList(token) }
                .onSuccess { result ->
                    _state.value = _state.value.copy(
                        remoteSessionCount = result.sessions.size,
                        relayHealthy = true,
                        errorMessage = null,
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        relayHealthy = false,
                        errorMessage = error.message,
                    )
                }
        }
    }

    fun updateMode(mode: ConnectionMode) {
        LocalConnectionPrefs.mode = mode
        _state.value = _state.value.copy(mode = mode)
    }

    fun updateManualIp(value: String) {
        _state.value = _state.value.copy(manualIp = value)
    }

    fun updateManualPort(value: String) {
        _state.value = _state.value.copy(manualPort = value)
    }

    fun saveLocalTarget(): Boolean {
        val port = _state.value.manualPort.toIntOrNull()
        if (port == null || port !in 1..65535) {
            _state.value = _state.value.copy(errorMessage = getApplication<Application>().getString(R.string.environment_port_invalid))
            return false
        }
        LocalConnectionPrefs.manualIp = _state.value.manualIp.trim()
        LocalConnectionPrefs.manualPort = port
        _state.value = _state.value.copy(errorMessage = null)
        refresh()
        return true
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnvironmentScreen(
    onOpenSessions: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: EnvironmentViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val clipboard = LocalClipboard.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val copyServerLabel = stringResource(R.string.environment_action_copy_server)
    val copySessionLabel = stringResource(R.string.environment_action_copy_session)
    val copyDeviceLabel = stringResource(R.string.environment_action_copy_device)

    LaunchedEffect(Unit) {
        vm.refresh()
    }

    fun copyValue(label: String, value: String) {
        if (value == "-") return
        clipboard.nativeClipboard.setPrimaryClip(ClipData.newPlainText(label, value))
        scope.launch { snackbar.showSnackbar(label) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.environment_title)) },
                actions = {
                    IconButton(onClick = { vm.refresh() }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_refresh),
                            contentDescription = stringResource(R.string.common_refresh),
                        )
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                EnvironmentSectionCard(title = stringResource(R.string.environment_section_overview)) {
                    EnvironmentInfoRow(stringResource(R.string.environment_label_active_profile), state.activeProfile)
                    EnvironmentInfoRow(stringResource(R.string.environment_label_server_url), state.serverUrl)
                    EnvironmentInfoRow(stringResource(R.string.environment_label_device_id), state.deviceId)
                    EnvironmentInfoRow(stringResource(R.string.environment_label_session_id), state.sessionId)
                    EnvironmentInfoRow(
                        stringResource(R.string.environment_label_gateway),
                        buildGatewayText(state.gateway, state.connected)
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(onClick = { copyValue(copyServerLabel, state.serverUrl) }, modifier = Modifier.weight(1f)) {
                            Text(copyServerLabel)
                        }
                        OutlinedButton(onClick = { copyValue(copySessionLabel, state.sessionId) }, modifier = Modifier.weight(1f)) {
                            Text(copySessionLabel)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { copyValue(copyDeviceLabel, state.deviceId) }, modifier = Modifier.fillMaxWidth()) {
                        Text(copyDeviceLabel)
                    }
                }
            }

            item {
                EnvironmentSectionCard(title = stringResource(R.string.environment_section_connection_mode)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ConnectionMode.entries.forEach { mode ->
                            FilterChip(
                                selected = state.mode == mode,
                                onClick = { vm.updateMode(mode) },
                                label = { Text(stringResource(mode.labelRes)) }
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = when (state.mode) {
                            ConnectionMode.AUTO -> stringResource(R.string.settings_connection_mode_auto_desc)
                            ConnectionMode.LOCAL -> stringResource(R.string.settings_connection_mode_local_desc)
                            ConnectionMode.RELAY -> stringResource(R.string.settings_connection_mode_relay_desc)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }

            item {
                EnvironmentSectionCard(title = stringResource(R.string.environment_section_local_direct)) {
                    OutlinedTextField(
                        value = state.manualIp,
                        onValueChange = vm::updateManualIp,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text(stringResource(R.string.environment_label_manual_ip)) },
                        supportingText = { Text(stringResource(R.string.environment_hint_manual_ip)) },
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = state.manualPort,
                        onValueChange = vm::updateManualPort,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text(stringResource(R.string.environment_label_manual_port)) },
                        supportingText = { Text(stringResource(R.string.environment_hint_manual_port)) },
                        keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = { vm.saveLocalTarget() }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.environment_action_save_local))
                    }
                }
            }

            item {
                EnvironmentSectionCard(title = stringResource(R.string.environment_section_health)) {
                    Text(buildHealthSummary(state))
                    state.errorMessage?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(onClick = onOpenSessions, modifier = Modifier.weight(1f)) {
                            Text(stringResource(R.string.environment_action_open_sessions))
                        }
                        OutlinedButton(onClick = onOpenSettings, modifier = Modifier.weight(1f)) {
                            Text(stringResource(R.string.environment_action_open_settings))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EnvironmentSectionCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
            )
            content()
        }
    }
}

@Composable
private fun EnvironmentInfoRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun buildGatewayText(connectionType: String, connected: Boolean): String {
    val status = if (connected) {
        stringResource(R.string.environment_health_connected)
    } else {
        stringResource(R.string.environment_health_disconnected)
    }
    val gateway = when (connectionType.lowercase()) {
        "local" -> stringResource(R.string.connection_mode_local_label)
        else -> stringResource(R.string.connection_mode_relay_label)
    }
    return "$status · $gateway"
}

@Composable
private fun buildHealthSummary(state: EnvironmentViewModel.UiState): String {
    val relay = when (state.relayHealthy) {
        true -> stringResource(R.string.environment_health_relay_ok)
        false -> stringResource(R.string.environment_health_relay_failed)
        null -> stringResource(R.string.common_refresh)
    }
    val count = state.remoteSessionCount?.toString() ?: "-"
    return buildString {
        append(buildGatewayText(state.gateway, state.connected))
        append("\n")
        append(stringResource(R.string.environment_label_remote_sessions))
        append(": ")
        append(count)
        append("\n")
        append(relay)
    }
}

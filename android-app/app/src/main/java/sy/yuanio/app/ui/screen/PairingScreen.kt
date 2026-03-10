package sy.yuanio.app.ui.screen

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import sy.yuanio.app.R
import sy.yuanio.app.ui.component.QrScanner
import sy.yuanio.app.ui.component.BrandChipRow
import org.json.JSONObject

@androidx.camera.core.ExperimentalGetImage
@Composable
fun PairingScreen(onPaired: () -> Unit, vm: PairingViewModel = viewModel()) {
    var code by remember { mutableStateOf("") }
    var serverUrl by remember { mutableStateOf("http://10.0.2.2:3000") }
    var profileName by remember { mutableStateOf("default") }
    var showScanner by remember { mutableStateOf(false) }
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(state) {
        if (state is PairingViewModel.State.Success) onPaired()
    }
    LaunchedEffect(Unit) {
        if (vm.isPaired) onPaired()
    }

    if (showScanner) {
        QrScanner(
            onResult = { raw ->
                showScanner = false
                try {
                    val obj = JSONObject(raw)
                    serverUrl = obj.optString("server", serverUrl)
                    code = obj.optString("code", "")
                } catch (_: Exception) {
                    code = raw
                }
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    val isLoading = state is PairingViewModel.State.Loading
    val isValidCode = code.matches(Regex("\\d{3}-\\d{3}"))
    val sectionCardColors = CardDefaults.cardColors(
        containerColor = MaterialTheme.colorScheme.surface
    )
    val sectionCardBorder = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineLarge)
                    Text(
                        stringResource(R.string.pairing_tagline),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        stringResource(R.string.common_supported_models),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.outline
                    )
                    BrandChipRow()
                }
            }

            item {
                Card(
                    colors = sectionCardColors,
                    border = sectionCardBorder,
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(stringResource(R.string.pairing_section_info), style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = profileName,
                            onValueChange = { profileName = it },
                            label = { Text(stringResource(R.string.pairing_label_project_name)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = { serverUrl = it },
                            label = { Text(stringResource(R.string.pairing_label_server_url)) },
                            singleLine = true,
                            supportingText = { Text(stringResource(R.string.pairing_hint_server_url)) },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = code,
                            onValueChange = { if (it.length <= 7) code = it },
                            label = { Text(stringResource(R.string.pairing_label_code)) },
                            supportingText = { Text(stringResource(R.string.pairing_hint_code)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            item {
                Card(
                    colors = sectionCardColors,
                    border = sectionCardBorder,
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(stringResource(R.string.pairing_section_actions), style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = { vm.pair(code, serverUrl, profileName) },
                            enabled = isValidCode && !isLoading,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(
                                if (isLoading) {
                                    stringResource(R.string.pairing_button_connecting)
                                } else {
                                    stringResource(R.string.pairing_button_connect)
                                }
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { showScanner = true },
                            enabled = !isLoading,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_tb_qrcode),
                                contentDescription = stringResource(R.string.pairing_cd_scan),
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.pairing_button_scan))
                        }
                    }
                }
            }

            if (state is PairingViewModel.State.Error) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_tb_alert_triangle),
                                contentDescription = stringResource(R.string.notifier_error_title),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                (state as PairingViewModel.State.Error).message,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }

            item {
                Card(
                    colors = sectionCardColors,
                    border = sectionCardBorder,
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(stringResource(R.string.pairing_section_security), style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                painter = painterResource(R.drawable.ic_tb_circle_check),
                                contentDescription = stringResource(R.string.pairing_cd_end_to_end),
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.pairing_security_end_to_end))
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                painter = painterResource(R.drawable.ic_tb_alert_triangle),
                                contentDescription = stringResource(R.string.pairing_cd_verify_server),
                                tint = MaterialTheme.colorScheme.tertiary
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.pairing_security_verify_server))
                        }
                    }
                }
            }
        }
    }
}


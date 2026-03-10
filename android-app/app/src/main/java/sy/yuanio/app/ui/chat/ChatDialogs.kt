package sy.yuanio.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R

@Composable
fun ChatDialogs(
    showTemplateDialog: Boolean,
    showAutoPilotDialog: Boolean,
    onDismissTemplateDialog: () -> Unit,
    onDismissAutoPilotDialog: () -> Unit,
    onSaveTemplate: (String, String) -> Unit,
    onStartAutoPilot: (String, Int) -> Unit,
) {
    if (showTemplateDialog) {
        TemplateEditorDialog(
            onDismiss = onDismissTemplateDialog,
            onSave = onSaveTemplate
        )
    }
    if (showAutoPilotDialog) {
        AutoPilotDialog(
            onDismiss = onDismissAutoPilotDialog,
            onStart = onStartAutoPilot
        )
    }
}

@Composable
fun TemplateEditorDialog(
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var label by rememberSaveable { mutableStateOf("") }
    var prompt by rememberSaveable { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_dialog_template_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(stringResource(R.string.chat_dialog_template_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text(stringResource(R.string.chat_dialog_template_prompt)) },
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(label.trim(), prompt.trim()) },
                enabled = label.isNotBlank() && prompt.isNotBlank()
            ) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
fun AutoPilotDialog(
    onDismiss: () -> Unit,
    onStart: (String, Int) -> Unit,
) {
    var prompt by rememberSaveable { mutableStateOf("continue") }
    var maxRounds by rememberSaveable { mutableStateOf("10") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_dialog_auto_pilot_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(R.string.chat_dialog_auto_pilot_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text(stringResource(R.string.chat_dialog_auto_pilot_prompt)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = maxRounds,
                    onValueChange = { maxRounds = it.filter(Char::isDigit) },
                    label = { Text(stringResource(R.string.chat_dialog_auto_pilot_max_rounds)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onStart(prompt.trim(), maxRounds.toIntOrNull() ?: 10) },
                enabled = prompt.isNotBlank()
            ) { Text(stringResource(R.string.chat_dialog_auto_pilot_start)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}


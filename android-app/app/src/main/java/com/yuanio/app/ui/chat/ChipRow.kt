package com.yuanio.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.data.ComposerStyle
import com.yuanio.app.data.ModelMode
import com.yuanio.app.data.PermissionMode
import com.yuanio.app.ui.screen.ChatViewModel

@Composable
fun ChipRow(
    state: InputBarState,
    onSwitchAgent: (String) -> Unit,
    onSetPermission: (PermissionMode) -> Unit,
    onSetModel: (ModelMode) -> Unit,
    onAutoPilotToggle: () -> Unit,
    onSetVoiceLanguage: (String) -> Unit,
    onSetComposerStyle: (ComposerStyle) -> Unit,
    onBroadcastLatestTts: () -> Unit,
    onToggleVoiceAutoSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item {
            Box {
                var showAgentMenu by remember { mutableStateOf(false) }
                InputSelectorChip(
                    label = state.agentState.agent.replaceFirstChar { it.uppercase() },
                    onClick = { showAgentMenu = true },
                )
                AgentSettingsMenu(
                    expanded = showAgentMenu,
                    onDismissRequest = { showAgentMenu = false },
                    agentState = state.agentState,
                    onSwitchAgent = onSwitchAgent,
                )
            }
        }

        item {
            Box {
                var showModelMenu by remember { mutableStateOf(false) }
                InputSelectorChip(
                    label = stringResource(state.agentState.modelMode.labelRes),
                    onClick = { showModelMenu = true },
                )
                ModelSettingsMenu(
                    expanded = showModelMenu,
                    onDismissRequest = { showModelMenu = false },
                    agentState = state.agentState,
                    onSetPermission = onSetPermission,
                    onSetModel = onSetModel,
                )
            }
        }

        item {
            Box {
                var showOptionsMenu by remember { mutableStateOf(false) }
                InputSelectorChip(
                    label = stringResource(R.string.chat_input_cd_settings),
                    onClick = { showOptionsMenu = true },
                    leadingIconRes = R.drawable.ic_tb_settings,
                )
                OptionsSettingsMenu(
                    expanded = showOptionsMenu,
                    onDismissRequest = { showOptionsMenu = false },
                    autoPilot = state.autoPilot,
                    voiceLanguageTag = state.voiceLanguageTag,
                    onSetVoiceLanguage = onSetVoiceLanguage,
                    voiceAutoSubmit = state.voiceAutoSubmit,
                    onToggleVoiceAutoSubmit = onToggleVoiceAutoSubmit,
                    composerStyle = state.composerStyle,
                    onSetComposerStyle = onSetComposerStyle,
                    onAutoPilotToggle = onAutoPilotToggle,
                    onBroadcastLatestTts = onBroadcastLatestTts,
                )
            }
        }
    }
}

@Composable
private fun InputSelectorChip(
    label: String,
    onClick: () -> Unit,
    leadingIconRes: Int? = null,
) {
    AssistChip(
        onClick = onClick,
        label = { Text(label) },
        leadingIcon = leadingIconRes?.let { iconRes ->
            {
                Icon(
                    painter = painterResource(iconRes),
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
            }
        },
        trailingIcon = {
            Icon(
                painter = painterResource(R.drawable.ic_tb_chevron_down),
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
        border = null,
        shape = RoundedCornerShape(8.dp),
    )
}

@Composable
private fun AgentSettingsMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    agentState: ChatViewModel.AgentHeartbeat,
    onSwitchAgent: (String) -> Unit,
) {
    val agents = listOf("codex", "claude", "gemini")
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest) {
        agents.forEach { agent ->
            DropdownMenuItem(
                text = {
                    val label = agent.replaceFirstChar { it.uppercase() }
                    Text(if (agent == agentState.agent) "✓ $label" else label)
                },
                onClick = {
                    onDismissRequest()
                    if (agent != agentState.agent) onSwitchAgent(agent)
                },
            )
        }
    }
}

@Composable
private fun ModelSettingsMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    agentState: ChatViewModel.AgentHeartbeat,
    onSetPermission: (PermissionMode) -> Unit,
    onSetModel: (ModelMode) -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest) {
        Text(
            text = stringResource(R.string.chat_input_menu_model),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        ModelMode.entries.forEach { mode ->
            DropdownMenuItem(
                text = {
                    val label = stringResource(mode.labelRes)
                    Text(if (mode == agentState.modelMode) "✓ $label" else label)
                },
                onClick = {
                    onDismissRequest()
                    if (mode != agentState.modelMode) onSetModel(mode)
                },
            )
        }

        HorizontalDivider()
        Text(
            text = stringResource(R.string.chat_input_menu_permission),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        PermissionMode.entries.forEach { mode ->
            DropdownMenuItem(
                text = {
                    val label = stringResource(mode.labelRes)
                    Text(if (mode == agentState.permissionMode) "✓ $label" else label)
                },
                onClick = {
                    onDismissRequest()
                    if (mode != agentState.permissionMode) onSetPermission(mode)
                },
            )
        }
    }
}

@Composable
private fun OptionsSettingsMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    autoPilot: ChatViewModel.AutoPilotState,
    voiceLanguageTag: String,
    onSetVoiceLanguage: (String) -> Unit,
    voiceAutoSubmit: Boolean,
    onToggleVoiceAutoSubmit: () -> Unit,
    composerStyle: ComposerStyle,
    onSetComposerStyle: (ComposerStyle) -> Unit,
    onAutoPilotToggle: () -> Unit,
    onBroadcastLatestTts: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest) {
        Text(
            text = stringResource(R.string.chat_input_menu_composer_style),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        ComposerStyle.entries.forEach { style ->
            DropdownMenuItem(
                text = {
                    val label = when (style) {
                        ComposerStyle.CLAUDE -> stringResource(R.string.chat_input_style_claude)
                        ComposerStyle.CHATGPT -> stringResource(R.string.chat_input_style_chatgpt)
                        ComposerStyle.GEMINI -> stringResource(R.string.chat_input_style_gemini)
                    }
                    Text(if (style == composerStyle) "✓ $label" else label)
                },
                onClick = {
                    onDismissRequest()
                    if (style != composerStyle) onSetComposerStyle(style)
                },
            )
        }

        HorizontalDivider()
        Text(
            text = stringResource(R.string.chat_input_menu_voice_language),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        val voiceLanguageOptions = listOf(
            "auto" to stringResource(R.string.chat_input_voice_lang_auto),
            "zh-CN" to stringResource(R.string.chat_input_voice_lang_zh_cn),
            "en-US" to stringResource(R.string.chat_input_voice_lang_en_us),
        )
        voiceLanguageOptions.forEach { (tag, label) ->
            DropdownMenuItem(
                text = { Text(if (tag == voiceLanguageTag) "✓ $label" else label) },
                onClick = {
                    onDismissRequest()
                    if (tag != voiceLanguageTag) onSetVoiceLanguage(tag)
                },
            )
        }

        HorizontalDivider()
        DropdownMenuItem(
            text = {
                Text(
                    if (voiceAutoSubmit) {
                        stringResource(R.string.chat_input_menu_voice_auto_submit_on)
                    } else {
                        stringResource(R.string.chat_input_menu_voice_auto_submit_off)
                    },
                )
            },
            onClick = {
                onDismissRequest()
                onToggleVoiceAutoSubmit()
            },
        )

        HorizontalDivider()
        DropdownMenuItem(
            text = {
                Text(
                    if (autoPilot.enabled) {
                        stringResource(R.string.chat_input_menu_auto_pilot_disable, autoPilot.iteration)
                    } else {
                        stringResource(R.string.chat_input_menu_auto_pilot_enable)
                    },
                )
            },
            onClick = {
                onDismissRequest()
                onAutoPilotToggle()
            },
        )
        DropdownMenuItem(
            text = { Text(stringResource(R.string.chat_input_menu_tts_latest)) },
            onClick = {
                onDismissRequest()
                onBroadcastLatestTts()
            },
        )
    }
}

package com.yuanio.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.ui.component.MarkdownText
import com.yuanio.app.ui.screen.ChatViewModel

@Composable
fun ComposerField(
    state: InputBarState,
    onInputChange: (String) -> Unit,
    onTranslateAuto: () -> Unit,
    onToggleMarkdownPreview: () -> Unit,
    onInsertBold: () -> Unit,
    onInsertCodeBlock: () -> Unit,
    onInsertQuote: () -> Unit,
    onInsertBulletList: () -> Unit,
    onInsertNumberedList: () -> Unit,
    onInsertLink: () -> Unit,
    onCancelEdit: () -> Unit,
    onCommandSuggestionClick: (ChatViewModel.SlashCommandSuggestion) -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    var showMarkdownTools by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        AnimatedVisibility(visible = state.isEditingMessage) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = state.editingMessageLabel ?: stringResource(R.string.chat_input_editing),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                TextButton(onClick = onCancelEdit) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        }

        if (state.markdownPreview) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
            ) {
                if (state.input.isBlank()) {
                    Text(
                        text = stringResource(R.string.chat_input_preview_empty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.padding(12.dp),
                    )
                } else {
                    Box(modifier = Modifier.padding(12.dp)) {
                        MarkdownText(state.input)
                    }
                }
            }
        } else {
            BasicTextField(
                value = state.input,
                onValueChange = onInputChange,
                enabled = state.viewingActiveSession,
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                maxLines = 5,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                decorationBox = { innerTextField ->
                    if (state.input.isBlank()) {
                        Text(
                            text = if (state.shellMode) {
                                stringResource(R.string.chat_input_placeholder_command)
                            } else {
                                stringResource(R.string.chat_input_placeholder_message)
                            },
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    innerTextField()
                },
            )
        }

        AnimatedVisibility(visible = state.voiceListening) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    VoiceWaveIndicator(
                        active = true,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text(
                        text = state.voicePartialText?.takeIf { it.isNotBlank() }
                            ?: stringResource(R.string.chat_input_voice_listening),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                }
            }
        }

        AnimatedVisibility(visible = state.showCommandSuggestions) {
            Column {
                Spacer(Modifier.height(8.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                ) {
                    Column {
                        val groupedSuggestions = state.commandSuggestions.groupBy { it.group }
                        groupedSuggestions.entries.forEachIndexed { groupIndex, (group, suggestions) ->
                            if (groupIndex > 0) {
                                HorizontalDivider(
                                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f),
                                )
                            }
                            Text(
                                text = group,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.outline,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                            suggestions.forEachIndexed { index, suggestion ->
                                TextButton(
                                    onClick = { onCommandSuggestionClick(suggestion) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalArrangement = Arrangement.spacedBy(2.dp),
                                    ) {
                                        Text(
                                            text = "/${suggestion.command} · ${suggestion.usage}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurface,
                                        )
                                        Text(
                                            text = suggestion.description,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.outline,
                                        )
                                        suggestion.argsTemplate
                                            ?.takeIf { it.isNotBlank() }
                                            ?.let { template ->
                                                Text(
                                                    text = template,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.primary,
                                                )
                                            }
                                        suggestion.example
                                            ?.takeIf { it.isNotBlank() }
                                            ?.let { example ->
                                                Text(
                                                    text = example,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.outline,
                                                )
                                            }
                                    }
                                }
                                if (index < suggestions.lastIndex) {
                                    HorizontalDivider(
                                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.25f),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        AnimatedVisibility(visible = state.viewingActiveSession && state.hasText) {
            Column {
                Spacer(Modifier.height(4.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { showMarkdownTools = !showMarkdownTools }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_file_description),
                            contentDescription = stringResource(R.string.chat_input_markdown_tools),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    TextButton(
                        onClick = onTranslateAuto,
                        enabled = !state.translatingInput,
                    ) {
                        Text(
                            text = if (state.translatingInput) {
                                stringResource(R.string.chat_input_action_translate_working)
                            } else {
                                stringResource(R.string.chat_input_action_translate_auto)
                            },
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onToggleMarkdownPreview) {
                        Text(
                            text = if (state.markdownPreview) {
                                stringResource(R.string.chat_input_edit_mode)
                            } else {
                                stringResource(R.string.chat_input_preview_mode)
                            },
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                }
                AnimatedVisibility(visible = showMarkdownTools) {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        item {
                            AssistChip(onClick = onInsertBold, label = { Text("**B**") })
                        }
                        item {
                            AssistChip(onClick = onInsertCodeBlock, label = { Text("{ }") })
                        }
                        item {
                            AssistChip(
                                onClick = onInsertQuote,
                                label = { Text(stringResource(R.string.chat_input_markdown_quote)) },
                            )
                        }
                        item {
                            AssistChip(
                                onClick = onInsertBulletList,
                                label = { Text(stringResource(R.string.chat_input_markdown_bullet)) },
                            )
                        }
                        item {
                            AssistChip(
                                onClick = onInsertNumberedList,
                                label = { Text(stringResource(R.string.chat_input_markdown_numbered)) },
                            )
                        }
                        item {
                            AssistChip(
                                onClick = onInsertLink,
                                label = { Text(stringResource(R.string.chat_input_markdown_link)) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceWaveIndicator(
    active: Boolean,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "voice_wave")
    val alpha by transition.animateFloat(
        initialValue = if (active) 0.35f else 0.15f,
        targetValue = if (active) 1f else 0.35f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = 900
                0.35f at 0 using LinearEasing
                1f at 450 using LinearEasing
                0.35f at 900 using LinearEasing
            },
            repeatMode = RepeatMode.Restart,
        ),
        label = "voice_wave_alpha",
    )
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { index ->
            Box(
                modifier = Modifier
                    .size(6.dp + index.dp)
                    .background(color.copy(alpha = alpha - index * 0.15f), CircleShape),
            )
        }
    }
}

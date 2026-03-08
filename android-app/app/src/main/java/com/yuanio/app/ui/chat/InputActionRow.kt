package com.yuanio.app.ui.chat

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.yuanio.app.R

@Composable
fun InputActionRow(
    state: InputBarState,
    onOpenFiles: () -> Unit,
    onPickImage: () -> Unit,
    onTakePhoto: () -> Unit,
    onOpenQuickPrompt: () -> Unit,
    onSmartPaste: () -> Unit,
    onVoiceInputToggle: () -> Unit,
    onVoicePressStart: () -> Unit,
    onVoicePressEnd: () -> Unit,
    onSend: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showAttachmentsMenu by remember { mutableStateOf(false) }
    var holdPressTriggered by remember { mutableStateOf(false) }

    LaunchedEffect(state.holdToTalkEnabled) {
        if (!state.holdToTalkEnabled) {
            holdPressTriggered = false
        }
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (state.showAttachmentsAsMenu) {
            AttachmentMenuButton(
                enabled = state.viewingActiveSession,
                expanded = showAttachmentsMenu,
                onExpand = { showAttachmentsMenu = true },
                onDismiss = { showAttachmentsMenu = false },
                onOpenFiles = {
                    showAttachmentsMenu = false
                    onOpenFiles()
                },
                onSmartPaste = {
                    showAttachmentsMenu = false
                    onSmartPaste()
                },
                onPickImage = {
                    showAttachmentsMenu = false
                    onPickImage()
                },
                onTakePhoto = {
                    showAttachmentsMenu = false
                    onTakePhoto()
                },
                onOpenQuickPrompt = {
                    showAttachmentsMenu = false
                    onOpenQuickPrompt()
                },
            )
        } else {
            AttachmentActionButton(
                iconRes = R.drawable.ic_ms_folder,
                contentDescriptionRes = R.string.chat_input_cd_files,
                enabled = state.viewingActiveSession,
                onClick = onOpenFiles,
            )
            AttachmentActionButton(
                iconRes = R.drawable.ic_ms_image,
                contentDescriptionRes = R.string.chat_input_cd_images,
                enabled = state.viewingActiveSession,
                onClick = onPickImage,
            )
            AttachmentActionButton(
                iconRes = R.drawable.ic_ms_photo_camera,
                contentDescriptionRes = R.string.chat_input_cd_take_photo,
                enabled = state.viewingActiveSession,
                onClick = onTakePhoto,
            )
            AttachmentActionButton(
                iconRes = R.drawable.ic_ms_content_copy,
                contentDescriptionRes = R.string.chat_input_cd_smart_paste,
                enabled = state.viewingActiveSession,
                onClick = onSmartPaste,
            )
            AttachmentActionButton(
                iconRes = R.drawable.ic_ms_description,
                contentDescriptionRes = R.string.chat_input_cd_file_content,
                enabled = state.viewingActiveSession,
                onClick = onOpenQuickPrompt,
            )
        }

        Spacer(Modifier.weight(1f))

        FilledIconButton(
            onClick = onVoiceInputToggle,
            enabled = state.voiceActionEnabled && !state.streaming,
            modifier = Modifier
                .size(38.dp)
                .pointerInput(state.holdToTalkEnabled) {
                    if (!state.holdToTalkEnabled) return@pointerInput
                    detectTapGestures(
                        onLongPress = {
                            holdPressTriggered = true
                            onVoicePressStart()
                        },
                        onPress = {
                            tryAwaitRelease()
                            if (holdPressTriggered) {
                                holdPressTriggered = false
                                onVoicePressEnd()
                            }
                        },
                    )
                },
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = if (state.voiceListening) {
                    MaterialTheme.colorScheme.errorContainer
                } else {
                    MaterialTheme.colorScheme.surface
                },
                contentColor = if (state.voiceListening) {
                    MaterialTheme.colorScheme.onErrorContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                disabledContainerColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) {
            Icon(
                painter = painterResource(
                    if (state.voiceListening) R.drawable.ic_ms_stop else R.drawable.ic_ms_mic,
                ),
                contentDescription = if (state.voiceListening) {
                    stringResource(R.string.chat_input_cd_voice_stop)
                } else {
                    stringResource(R.string.chat_input_cd_voice_input)
                },
                modifier = Modifier.size(18.dp),
            )
        }

        FilledIconButton(
            onClick = if (state.streaming) onCancel else onSend,
            enabled = if (state.streaming) true else state.sendEnabled,
            modifier = Modifier.size(38.dp),
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = when {
                    state.streaming -> MaterialTheme.colorScheme.error
                    state.sendEnabled -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)
                },
                contentColor = when {
                    state.streaming -> MaterialTheme.colorScheme.onError
                    state.sendEnabled -> MaterialTheme.colorScheme.onPrimary
                    else -> Color.White
                },
                disabledContainerColor = MaterialTheme.colorScheme.outlineVariant,
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) {
            Icon(
                painter = painterResource(
                    if (state.streaming) R.drawable.ic_ms_stop else R.drawable.ic_ms_send,
                ),
                contentDescription = if (state.streaming) {
                    stringResource(R.string.chat_input_cd_stop)
                } else {
                    stringResource(R.string.chat_input_cd_send)
                },
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun AttachmentMenuButton(
    enabled: Boolean,
    expanded: Boolean,
    onExpand: () -> Unit,
    onDismiss: () -> Unit,
    onOpenFiles: () -> Unit,
    onSmartPaste: () -> Unit,
    onPickImage: () -> Unit,
    onTakePhoto: () -> Unit,
    onOpenQuickPrompt: () -> Unit,
) {
    Box {
        IconButton(onClick = onExpand, enabled = enabled) {
            Icon(
                painter = painterResource(R.drawable.ic_ms_add),
                contentDescription = stringResource(R.string.common_more),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_input_cd_files)) },
                onClick = onOpenFiles,
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_input_cd_smart_paste)) },
                onClick = onSmartPaste,
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_input_cd_images)) },
                onClick = onPickImage,
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_input_cd_take_photo)) },
                onClick = onTakePhoto,
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_input_cd_file_content)) },
                onClick = onOpenQuickPrompt,
            )
        }
    }
}

@Composable
private fun AttachmentActionButton(
    iconRes: Int,
    contentDescriptionRes: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(
            painter = painterResource(iconRes),
            contentDescription = stringResource(contentDescriptionRes),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

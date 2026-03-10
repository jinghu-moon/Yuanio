package sy.yuanio.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R
import sy.yuanio.app.data.ComposerStyle
import sy.yuanio.app.data.ModelMode
import sy.yuanio.app.data.PermissionMode
import sy.yuanio.app.ui.screen.ChatViewModel

@Composable
fun ChatInputBar(
    state: InputBarState,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onCancel: () -> Unit,
    onSwitchAgent: (String) -> Unit,
    onSetPermission: (PermissionMode) -> Unit,
    onSetModel: (ModelMode) -> Unit,
    onAutoPilotToggle: () -> Unit,
    onVoiceInputToggle: () -> Unit,
    onVoicePressStart: () -> Unit,
    onVoicePressEnd: () -> Unit,
    onSetVoiceLanguage: (String) -> Unit,
    onSetComposerStyle: (ComposerStyle) -> Unit,
    onBroadcastLatestTts: () -> Unit,
    onTranslateAuto: () -> Unit,
    showTranslate: Boolean,
    onOpenFiles: () -> Unit,
    onPickImage: () -> Unit,
    onTakePhoto: () -> Unit,
    onOpenQuickPrompt: () -> Unit,
    onSendPendingDrafts: () -> Unit,
    onApproveAllSafe: () -> Unit,
    onSmartPaste: () -> Unit,
    onToggleMarkdownPreview: () -> Unit,
    onInsertBold: () -> Unit,
    onInsertCodeBlock: () -> Unit,
    onInsertQuote: () -> Unit,
    onInsertBulletList: () -> Unit,
    onInsertNumberedList: () -> Unit,
    onInsertLink: () -> Unit,
    onCancelEdit: () -> Unit,
    onToggleVoiceAutoSubmit: () -> Unit,
    onCommandSuggestionClick: (ChatViewModel.SlashCommandSuggestion) -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val composerContainerShape = RoundedCornerShape(22.dp)
    val composerContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .imePadding(),
    ) {
        PendingInputActions(
            pendingDraftCount = state.pendingDraftCount,
            safeApprovalCount = state.safeApprovalCount,
            onSendPendingDrafts = onSendPendingDrafts,
            onApproveAllSafe = onApproveAllSafe,
        )

        ChipRow(
            state = state,
            onSwitchAgent = onSwitchAgent,
            onSetPermission = onSetPermission,
            onSetModel = onSetModel,
            onAutoPilotToggle = onAutoPilotToggle,
            onSetVoiceLanguage = onSetVoiceLanguage,
            onSetComposerStyle = onSetComposerStyle,
            onBroadcastLatestTts = onBroadcastLatestTts,
            onToggleVoiceAutoSubmit = onToggleVoiceAutoSubmit,
        )

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = composerContainerShape,
            color = composerContainerColor,
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                ComposerField(
                    state = state,
                    onInputChange = onInputChange,
                    onTranslateAuto = onTranslateAuto,
                    showTranslate = showTranslate,
                    onToggleMarkdownPreview = onToggleMarkdownPreview,
                    onInsertBold = onInsertBold,
                    onInsertCodeBlock = onInsertCodeBlock,
                    onInsertQuote = onInsertQuote,
                    onInsertBulletList = onInsertBulletList,
                    onInsertNumberedList = onInsertNumberedList,
                    onInsertLink = onInsertLink,
                    onCancelEdit = onCancelEdit,
                    onCommandSuggestionClick = onCommandSuggestionClick,
                    focusRequester = focusRequester,
                )
                InputActionRow(
                    state = state,
                    onOpenFiles = onOpenFiles,
                    onPickImage = onPickImage,
                    onTakePhoto = onTakePhoto,
                    onOpenQuickPrompt = onOpenQuickPrompt,
                    onSmartPaste = onSmartPaste,
                    onVoiceInputToggle = onVoiceInputToggle,
                    onVoicePressStart = onVoicePressStart,
                    onVoicePressEnd = onVoicePressEnd,
                    onSend = onSend,
                    onCancel = onCancel,
                )
            }
        }
    }
}

@Composable
private fun PendingInputActions(
    pendingDraftCount: Int,
    safeApprovalCount: Int,
    onSendPendingDrafts: () -> Unit,
    onApproveAllSafe: () -> Unit,
) {
    if (pendingDraftCount <= 0 && safeApprovalCount <= 0) {
        return
    }

    Row(
        modifier = Modifier.padding(start = 8.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (pendingDraftCount > 0) {
            TextButton(onClick = onSendPendingDrafts) {
                Text(stringResource(R.string.chat_input_action_send_drafts, pendingDraftCount))
            }
        }
        if (safeApprovalCount > 0) {
            TextButton(onClick = onApproveAllSafe) {
                Text(stringResource(R.string.chat_input_action_approve_safe, safeApprovalCount))
            }
        }
    }
}


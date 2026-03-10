package sy.yuanio.app.ui.chat

import sy.yuanio.app.data.ComposerStyle
import sy.yuanio.app.data.ConnectionState
import sy.yuanio.app.ui.screen.ChatViewModel

data class InputBarState(
    val input: String,
    val agentState: ChatViewModel.AgentHeartbeat,
    val connState: ConnectionState,
    val composerStyle: ComposerStyle,
    val streaming: Boolean,
    val autoPilot: ChatViewModel.AutoPilotState,
    val viewingActiveSession: Boolean,
    val shellMode: Boolean,
    val voiceListening: Boolean,
    val voiceEnabled: Boolean,
    val voicePartialText: String?,
    val voiceLanguageTag: String,
    val pendingDraftCount: Int,
    val safeApprovalCount: Int,
    val translatingInput: Boolean,
    val markdownPreview: Boolean,
    val isEditingMessage: Boolean,
    val editingMessageLabel: String?,
    val voiceAutoSubmit: Boolean,
    val commandSuggestions: List<ChatViewModel.SlashCommandSuggestion>,
) {
    val isOnline: Boolean
        get() = connState == ConnectionState.CONNECTED

    val hasText: Boolean
        get() = input.isNotBlank()

    val sendEnabled: Boolean
        get() = hasText && isOnline && !streaming && viewingActiveSession

    val voiceActionEnabled: Boolean
        get() = viewingActiveSession && voiceEnabled

    val holdToTalkEnabled: Boolean
        get() = !streaming && !hasText && voiceActionEnabled

    val showAttachmentsAsMenu: Boolean
        get() = composerStyle != ComposerStyle.GEMINI

    val showCommandSuggestions: Boolean
        get() = viewingActiveSession && input.trimStart().startsWith("/") && commandSuggestions.isNotEmpty()
}


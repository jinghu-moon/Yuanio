package com.yuanio.app.ui.chat

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.yuanio.app.R
import com.yuanio.app.data.ComposerStyle
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.ModelMode
import com.yuanio.app.data.PermissionMode
import com.yuanio.app.ui.screen.ChatViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatInputBarTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun 设置菜单里的最近回复语音播报应触发回调() {
        var broadcastTriggered = false

        renderInputBar(
            state = baseState(input = "hello"),
            onBroadcastLatestTts = { broadcastTriggered = true },
        )

        composeRule.onNodeWithContentDescription(context.getString(R.string.chat_input_cd_settings)).performClick()
        composeRule.onNodeWithText(context.getString(R.string.chat_input_menu_tts_latest)).performClick()
        composeRule.waitForIdle()

        assertTrue(broadcastTriggered)
    }

    @Test
    fun 待处理草稿与低风险审批按钮应显示并触发回调() {
        var draftsTriggered = false
        var approvalsTriggered = false

        renderInputBar(
            state = baseState(pendingDraftCount = 2, safeApprovalCount = 1),
            onSendPendingDrafts = { draftsTriggered = true },
            onApproveAllSafe = { approvalsTriggered = true },
        )

        composeRule.onNodeWithText(context.getString(R.string.chat_input_action_send_drafts, 2)).assertIsDisplayed()
        composeRule.onNodeWithText(context.getString(R.string.chat_input_action_send_drafts, 2)).performClick()
        composeRule.onNodeWithText(context.getString(R.string.chat_input_action_approve_safe, 1)).assertIsDisplayed()
        composeRule.onNodeWithText(context.getString(R.string.chat_input_action_approve_safe, 1)).performClick()
        composeRule.waitForIdle()

        assertTrue(draftsTriggered)
        assertTrue(approvalsTriggered)
    }

    @Test
    fun slash建议应显示并触发选择回调() {
        var clickedCommand: String? = null
        val suggestion = ChatViewModel.SlashCommandSuggestion(
            command = "help",
            usage = "/help",
            description = "Show help",
            insertText = "/help",
            group = "System",
        )

        renderInputBar(
            state = baseState(
                input = "/h",
                commandSuggestions = listOf(suggestion),
            ),
            onCommandSuggestionClick = { clickedCommand = it.command },
        )

        composeRule.onNodeWithText("/help · /help").assertIsDisplayed()
        composeRule.onNodeWithText("/help · /help").performClick()
        composeRule.waitForIdle()

        assertEquals("help", clickedCommand)
    }

    @Test
    fun markdown预览开启且内容为空时应显示空预览文案() {
        renderInputBar(
            state = baseState(
                input = "",
                markdownPreview = true,
            ),
        )

        composeRule.onNodeWithText(context.getString(R.string.chat_input_preview_empty)).assertIsDisplayed()
    }

    @Test
    fun markdown预览切换按钮应触发回调() {
        var previewToggled = false

        renderInputBar(
            state = baseState(input = "# title"),
            onToggleMarkdownPreview = { previewToggled = true },
        )

        composeRule.onNodeWithText(context.getString(R.string.chat_input_preview_mode)).performClick()
        composeRule.waitForIdle()

        assertTrue(previewToggled)
    }

    @Test
    fun 附件菜单模式下文件入口应触发回调() {
        var filesOpened = false

        renderInputBar(
            state = baseState(composerStyle = ComposerStyle.CLAUDE),
            onOpenFiles = { filesOpened = true },
        )

        composeRule.onNodeWithContentDescription(context.getString(R.string.common_more)).performClick()
        composeRule.onNodeWithText(context.getString(R.string.chat_input_cd_files)).performClick()
        composeRule.waitForIdle()

        assertTrue(filesOpened)
    }

    @Test
    fun 语音按钮可用时应触发语音输入切换() {
        var voiceTriggered = false

        renderInputBar(
            state = baseState(voiceEnabled = true),
            onVoiceInputToggle = { voiceTriggered = true },
        )

        composeRule.onNodeWithContentDescription(context.getString(R.string.chat_input_cd_voice_input)).assertIsDisplayed()
        composeRule.onNodeWithContentDescription(context.getString(R.string.chat_input_cd_voice_input)).performClick()
        composeRule.waitForIdle()

        assertTrue(voiceTriggered)
    }

    private fun renderInputBar(
        state: InputBarState,
        onBroadcastLatestTts: () -> Unit = {},
        onSendPendingDrafts: () -> Unit = {},
        onApproveAllSafe: () -> Unit = {},
        onCommandSuggestionClick: (ChatViewModel.SlashCommandSuggestion) -> Unit = {},
        onToggleMarkdownPreview: () -> Unit = {},
        onOpenFiles: () -> Unit = {},
        onVoiceInputToggle: () -> Unit = {},
    ) {
        composeRule.setContent {
            val focusRequester = remember { FocusRequester() }
            MaterialTheme {
                ChatInputBar(
                    state = state,
                    onInputChange = {},
                    onSend = {},
                    onCancel = {},
                    onSwitchAgent = {},
                    onSetPermission = {},
                    onSetModel = {},
                    onAutoPilotToggle = {},
                    onVoiceInputToggle = onVoiceInputToggle,
                    onVoicePressStart = {},
                    onVoicePressEnd = {},
                    onSetVoiceLanguage = {},
                    onSetComposerStyle = {},
                    onBroadcastLatestTts = onBroadcastLatestTts,
                    onTranslateAuto = {},
                    onOpenFiles = onOpenFiles,
                    onPickImage = {},
                    onTakePhoto = {},
                    onOpenQuickPrompt = {},
                    onSendPendingDrafts = onSendPendingDrafts,
                    onApproveAllSafe = onApproveAllSafe,
                    onSmartPaste = {},
                    onToggleMarkdownPreview = onToggleMarkdownPreview,
                    onInsertBold = {},
                    onInsertCodeBlock = {},
                    onInsertQuote = {},
                    onInsertBulletList = {},
                    onInsertNumberedList = {},
                    onInsertLink = {},
                    onCancelEdit = {},
                    onToggleVoiceAutoSubmit = {},
                    onCommandSuggestionClick = onCommandSuggestionClick,
                    focusRequester = focusRequester,
                )
            }
        }
    }

    private fun baseState(
        input: String = "test",
        composerStyle: ComposerStyle = ComposerStyle.CLAUDE,
        voiceEnabled: Boolean = false,
        pendingDraftCount: Int = 0,
        safeApprovalCount: Int = 0,
        markdownPreview: Boolean = false,
        commandSuggestions: List<ChatViewModel.SlashCommandSuggestion> = emptyList(),
    ): InputBarState {
        return InputBarState(
            input = input,
            agentState = ChatViewModel.AgentHeartbeat(
                status = "idle",
                permissionMode = PermissionMode.DEFAULT,
                modelMode = ModelMode.DEFAULT,
            ),
            connState = ConnectionState.CONNECTED,
            composerStyle = composerStyle,
            streaming = false,
            autoPilot = ChatViewModel.AutoPilotState(),
            viewingActiveSession = true,
            shellMode = false,
            voiceListening = false,
            voiceEnabled = voiceEnabled,
            voicePartialText = null,
            voiceLanguageTag = "auto",
            pendingDraftCount = pendingDraftCount,
            safeApprovalCount = safeApprovalCount,
            translatingInput = false,
            markdownPreview = markdownPreview,
            isEditingMessage = false,
            editingMessageLabel = null,
            voiceAutoSubmit = false,
            commandSuggestions = commandSuggestions,
        )
    }
}

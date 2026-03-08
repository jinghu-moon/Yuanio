package com.yuanio.app.ui.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.ModelMode
import com.yuanio.app.data.PermissionMode
import com.yuanio.app.ui.screen.ChatViewModel
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatInputBarTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun 设置菜单语音播报应触发回调() {
        var broadcastTriggered = false
        composeRule.setContent {
            val focusRequester = remember { FocusRequester() }
            MaterialTheme {
                ChatInputBar(
                    input = "test",
                    onInputChange = {},
                    agentState = ChatViewModel.AgentHeartbeat(
                        status = "idle",
                        permissionMode = PermissionMode.DEFAULT,
                        modelMode = ModelMode.DEFAULT,
                    ),
                    connState = ConnectionState.CONNECTED,
                    streaming = false,
                    autoPilot = ChatViewModel.AutoPilotState(),
                    viewingActiveSession = true,
                    shellMode = false,
                    onSend = {},
                    onCancel = {},
                    onSwitchAgent = {},
                    onSetPermission = {},
                    onSetModel = {},
                    onAutoPilotToggle = {},
                    onVoiceInputToggle = {},
                    onVoicePressStart = {},
                    onVoicePressEnd = {},
                    voiceListening = false,
                    voiceEnabled = false,
                    voicePartialText = null,
                    voiceLanguageTag = "auto",
                    onSetVoiceLanguage = {},
                    onSetComposerStyle = {},
                    onBroadcastLatestTts = { broadcastTriggered = true },
                    pendingDraftCount = 0,
                    safeApprovalCount = 0,
                    translatingInput = false,
                    onTranslateAuto = {},
                    onOpenFiles = {},
                    onPickImage = {},
                    onTakePhoto = {},
                    onOpenQuickPrompt = {},
                    onSendPendingDrafts = {},
                    onApproveAllSafe = {},
                    onSmartPaste = {},
                    markdownPreview = false,
                    onToggleMarkdownPreview = {},
                    onInsertBold = {},
                    onInsertCodeBlock = {},
                    onInsertQuote = {},
                    onInsertBulletList = {},
                    onInsertNumberedList = {},
                    onInsertLink = {},
                    isEditingMessage = false,
                    editingMessageLabel = null,
                    onCancelEdit = {},
                    voiceAutoSubmit = false,
                    onToggleVoiceAutoSubmit = {},
                    commandSuggestions = emptyList(),
                    onCommandSuggestionClick = {},
                    focusRequester = focusRequester,
                )
            }
        }

        composeRule.onNodeWithContentDescription("设置").performClick()
        composeRule.onNodeWithText("语音播报最近回复").performClick()
        composeRule.waitForIdle()
        assertTrue(broadcastTriggered)
    }
}

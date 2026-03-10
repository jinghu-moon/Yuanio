package sy.yuanio.app.ui.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import sy.yuanio.app.ui.model.ChatItem
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatMessageListTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun 外部索引跳转应滚动到目标消息() {
        val targetState = mutableStateOf<Int?>(null)
        var handled = false
        val items = (0 until 120).map { idx ->
            ChatItem.Text(role = "ai", content = "msg_$idx", ts = idx.toLong())
        }

        composeRule.setContent {
            MaterialTheme {
                ChatMessageList(
                    items = items,
                    streaming = false,
                    waiting = false,
                    callbacks = MessageListCallbacks(
                        onSuggestionClick = {},
                        onRetry = {},
                        onFork = {},
                        onEdit = {},
                        onUndoSend = {},
                        canEdit = { false },
                        canUndoSend = { false },
                        onSpeak = { _, _ -> },
                        onStopSpeaking = {},
                        onTaskClick = {},
                        onApprove = {},
                        onReject = {},
                    ),
                    speakingIndex = -1,
                    searchActive = false,
                    searchQuery = "",
                    scrollToIndex = targetState.value,
                    onScrollToIndexHandled = {
                        handled = true
                        targetState.value = null
                    },
                )
            }
        }

        composeRule.runOnIdle {
            targetState.value = 88
        }
        composeRule.waitForIdle()

        composeRule.onNodeWithText("msg_88").assertIsDisplayed()
        assertTrue(handled)
    }
}


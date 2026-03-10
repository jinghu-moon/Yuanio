package sy.yuanio.app.ui.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import sy.yuanio.app.data.ConnectionState
import sy.yuanio.app.ui.screen.ChatViewModel
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatTopBarTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun 点击时间线菜单应触发回调() {
        var openedTimeline = false
        composeRule.setContent {
            MaterialTheme {
                ChatTopBar(
                    agentState = ChatViewModel.AgentHeartbeat(status = "idle", projectPath = "/tmp/yuanio"),
                    connState = ConnectionState.CONNECTED,
                    devices = emptyList(),
                    shellMode = false,
                    contextPercentage = 42,
                    searchActive = false,
                    searchQuery = "",
                    onSearchQueryChange = {},
                    onToggleSearch = {},
                    onNewSession = {},
                    onExport = {},
                    onNavigateSessions = {},
                    onNavigateFiles = {},
                    onNavigateTerminal = {},
                    onOpenTimeline = { openedTimeline = true },
                )
            }
        }

        composeRule.onNodeWithContentDescription("更多操作").performClick()
        composeRule.onNodeWithText("时间线").performClick()
        composeRule.waitForIdle()
        assertTrue(openedTimeline)
    }
}


package sy.yuanio.app.ui.component

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import sy.yuanio.app.R
import sy.yuanio.app.ui.model.ApprovalType
import sy.yuanio.app.ui.model.ChatItem
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ApprovalCardUiTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun 点击批准后回调不应同步触发且最终会完成() {
        var approveCount = 0

        composeRule.setContent {
            MaterialTheme {
                ApprovalCard(
                    approval = sampleApproval(),
                    onApprove = { approveCount++ },
                    onReject = {},
                )
            }
        }

        composeRule.onNodeWithText(context.getString(R.string.notifier_action_approve)).performClick()
        composeRule.runOnIdle {
            assertEquals(0, approveCount)
        }

        composeRule.waitUntil(timeoutMillis = 2_000) { approveCount == 1 }
        composeRule.runOnIdle {
            assertEquals(1, approveCount)
        }
    }

    private fun sampleApproval(): ChatItem.Approval {
        return ChatItem.Approval(
            id = "approval_ui",
            desc = "Edit src/main.kt",
            tool = "Edit",
            files = listOf("src/main.kt"),
            approvalType = ApprovalType.EDIT,
            preview = "@@ -1 +1 @@\n-old\n+new",
            diffHighlights = listOf("+println(\"ready\")"),
            riskLevel = "medium",
        )
    }
}


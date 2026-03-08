package com.yuanio.app.ui.component

import com.yuanio.app.ui.model.ApprovalType
import com.yuanio.app.ui.model.ChatItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalCardTest {

    @Test
    fun `EDIT 审批优先走 diff 预览模型`() {
        val model = buildApprovalCardModel(
            ChatItem.Approval(
                id = "apv_edit",
                desc = "Write src/app.ts",
                tool = "Write",
                files = listOf("src/app.ts"),
                approvalType = ApprovalType.EDIT,
                preview = "@@ -1 +1 @@\n-old\n+new",
                diffHighlights = listOf("+const ready = true"),
            )
        )

        assertEquals(ApprovalType.EDIT, model.type)
        assertEquals(ApprovalPreviewMode.DIFF, model.previewMode)
        assertTrue(model.metadata.any { it.contains("Write") })
        assertEquals("@@ -1 +1 @@\n-old\n+new", model.previewContent)
    }

    @Test
    fun `EXEC 审批会暴露权限和上下文信息`() {
        val model = buildApprovalCardModel(
            ChatItem.Approval(
                id = "apv_exec",
                desc = "Run npm test",
                tool = "bash",
                files = emptyList(),
                approvalType = ApprovalType.EXEC,
                context = "workingDir=/repo",
                permissionMode = "plan",
            )
        )

        assertEquals(ApprovalType.EXEC, model.type)
        assertEquals(ApprovalPreviewMode.NONE, model.previewMode)
        assertTrue(model.metadata.any { it.contains("workingDir=/repo") })
        assertTrue(model.metadata.any { it.contains("plan") })
    }

    @Test
    fun `MCP 审批在无 diff 时回落文本预览`() {
        val model = buildApprovalCardModel(
            ChatItem.Approval(
                id = "apv_mcp",
                desc = "Call MCP tool",
                tool = "mcp://server/search",
                files = emptyList(),
                approvalType = ApprovalType.MCP,
                preview = "query=project roadmap",
            )
        )

        assertEquals(ApprovalType.MCP, model.type)
        assertEquals(ApprovalPreviewMode.TEXT, model.previewMode)
        assertEquals("query=project roadmap", model.previewContent)
    }
}

package com.yuanio.app.data

import com.yuanio.app.ui.model.ApprovalType
import com.yuanio.app.ui.model.ChatItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentEventParserTest {

    private val parser = AgentEventParser()

    @Test
    fun `Claude thinking fixture 解析为 Thinking 事件`() {
        val payload = """{"thinking":"Let me analyze...","turnId":"turn_1","agent":"claude","ephemeral":false,"done":false}"""

        val parsed = parser.parse(
            type = "thinking",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "codex")
        )

        val event = parsed as ParsedAgentEvent.Thinking
        assertEquals(
            ChatItem.Thinking(
                content = "Let me analyze...",
                turnId = "turn_1",
                ephemeral = false,
                done = false,
                agent = "claude"
            ),
            event.item
        )
        assertEquals(false, event.done)
    }

    @Test
    fun `Claude tool_call running fixture 解析为 ToolCall 事件`() {
        val payload = """{"tool":"Read","params":{"file_path":"src/main.kt"},"status":"running","toolUseId":"tu_001","agent":"claude"}"""

        val parsed = parser.parse(type = "tool_call", payload = payload)

        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals("Read", event.item.tool)
        assertEquals("running", event.item.status)
        assertEquals("tu_001", event.item.toolUseId)
        assertEquals("claude", event.item.agent)
        assertTrue(event.paramsSummary.isNotBlank())
    }

    @Test
    fun `Claude tool_call done fixture 复用结果字段`() {
        val payload = """{"tool":"Read","params":{},"result":"file contents...","status":"done","toolUseId":"tu_001","agent":"claude"}"""

        val parsed = parser.parse(type = "tool_call", payload = payload)

        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals("done", event.item.status)
        assertEquals("file contents...", event.item.result)
        assertEquals("tu_001", event.item.toolUseId)
    }

    @Test
    fun `Claude approval fixture 解析为编辑型审批`() {
        val payload = """{"id":"apv_001","description":"Write file src/index.ts","tool":"Write","affectedFiles":["src/index.ts"],"riskLevel":"medium","riskSummary":"File modification","permissionMode":"default"}"""

        val parsed = parser.parse(
            type = "approval_req",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "claude")
        )

        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("apv_001", event.item.id)
        assertEquals("Write file src/index.ts", event.item.desc)
        assertEquals("Write", event.item.tool)
        assertEquals(listOf("src/index.ts"), event.item.files)
        assertEquals(ApprovalType.EDIT, event.item.approvalType)
        assertEquals("medium", event.item.riskLevel)
        assertEquals("File modification", event.item.riskSummary)
        assertEquals("default", event.item.permissionMode)
    }

    @Test
    fun `Claude file_diff fixture 解析为 FileDiff 事件`() {
        val payload = """{"path":"src/index.ts","diff":"@@ -1,3 +1,5 @@\n+import { foo } from './foo'\n ...","action":"modified"}"""

        val parsed = parser.parse(
            type = "file_diff",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "claude")
        )

        val event = parsed as ParsedAgentEvent.FileDiff
        assertEquals("src/index.ts", event.item.path)
        assertTrue(event.item.diff.contains("import { foo }"))
        assertEquals("modified", event.item.action)
        assertEquals("claude", event.item.agent)
    }

    @Test
    fun `Codex thinking fixture 保留 codex agent`() {
        val payload = """{"thinking":"I need to check...","turnId":"turn_c1","agent":"codex","done":false}"""

        val parsed = parser.parse(type = "thinking", payload = payload)

        val event = parsed as ParsedAgentEvent.Thinking
        assertEquals("I need to check...", event.item.content)
        assertEquals("turn_c1", event.item.turnId)
        assertEquals("codex", event.item.agent)
        assertEquals(false, event.done)
    }

    @Test
    fun `Codex approval fixture 解析为执行型审批`() {
        val payload = """{"id":"apv_c1","description":"Execute: npm test","tool":"Bash","affectedFiles":[],"riskLevel":"medium","riskSummary":"Shell command execution"}"""

        val parsed = parser.parse(
            type = "approval_req",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "codex")
        )

        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("apv_c1", event.item.id)
        assertEquals("Execute: npm test", event.item.desc)
        assertEquals(ApprovalType.EXEC, event.item.approvalType)
        assertEquals("medium", event.item.riskLevel)
        assertEquals("Shell command execution", event.item.riskSummary)
        assertEquals("codex", event.item.agent)
    }

    @Test
    fun `Gemini tool_call fixture 解析为 ToolCall 事件`() {
        val payload = """{"tool":"WriteFile","params":{"path":"src/app.ts"},"status":"running","toolUseId":"tu_g1","agent":"gemini"}"""

        val parsed = parser.parse(type = "tool_call", payload = payload)

        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals("WriteFile", event.item.tool)
        assertEquals("running", event.item.status)
        assertEquals("tu_g1", event.item.toolUseId)
        assertEquals("gemini", event.item.agent)
        assertTrue(event.paramsSummary.contains("src/app.ts"))
    }

    @Test
    fun `Gemini approval fixture 解析为高风险编辑审批`() {
        val payload = """{"id":"apv_g1","description":"Edit file src/app.ts","tool":"WriteFile","affectedFiles":["src/app.ts"],"riskLevel":"high","riskSummary":"File creation"}"""

        val parsed = parser.parse(
            type = "approval_req",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "gemini")
        )

        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("apv_g1", event.item.id)
        assertEquals(ApprovalType.EDIT, event.item.approvalType)
        assertEquals("high", event.item.riskLevel)
        assertEquals(listOf("src/app.ts"), event.item.files)
        assertEquals("gemini", event.item.agent)
    }

    @Test
    fun `approval_req 缺失 id 时回退 envelope id 并归一化风险`() {
        val payload = """{"description":"Write file src/index.ts","tool":"Write","affectedFiles":["src/index.ts"],"riskLevel":"critical","riskSummary":"File modification"}"""

        val parsed = parser.parse(
            type = "approval_req",
            payload = payload,
            context = AgentParseContext(envelopeId = "env_123", fallbackAgent = "claude")
        )

        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("env_123", event.item.id)
        assertEquals("Write file src/index.ts", event.item.desc)
        assertEquals("Write", event.item.tool)
        assertEquals(listOf("src/index.ts"), event.item.files)
        assertEquals(ApprovalType.EDIT, event.item.approvalType)
        assertEquals("high", event.item.riskLevel)
        assertEquals("claude", event.item.agent)
    }

    @Test
    fun `usage_report 解析为累计用量事件`() {
        val payload = """{"taskId":"task_1","usage":{"inputTokens":1500,"outputTokens":800,"cacheCreationTokens":200,"cacheReadTokens":100},"cumulative":true}"""

        val parsed = parser.parse(
            type = "usage_report",
            payload = payload,
            context = AgentParseContext(fallbackAgent = "gemini")
        )

        val event = parsed as ParsedAgentEvent.UsageReport
        assertEquals("task_1", event.item.taskId)
        assertEquals(1500, event.item.inputTokens)
        assertEquals(800, event.item.outputTokens)
        assertEquals(200, event.item.cacheCreationTokens)
        assertEquals(100, event.item.cacheReadTokens)
        assertEquals("gemini", event.item.agent)
        assertTrue(event.cumulative)
    }

    @Test
    fun `unknown type 返回 null`() {
        val parsed = parser.parse(type = "future_type", payload = "{}")
        assertNull(parsed)
    }

    @Test
    fun `malformed payload 返回 null 而不抛异常`() {
        val parsed = parser.parse(type = "thinking", payload = "not json")
        assertNull(parsed)
    }
}

package sy.yuanio.app.data

import sy.yuanio.app.ui.model.ApprovalType
import sy.yuanio.app.ui.model.ChatItem
import sy.yuanio.app.ui.model.ToolCallStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentEventParserTest {

    private val parser = AgentEventParser()

    @Test
    fun `Claude thinking fixture 解析为 Thinking 事件`() {
        val payload = """{"thinking":"Let me analyze...","turnId":"turn_1","agent":"claude","ephemeral":false,"done":false}"""
        val parsed = parser.parse(type = "thinking", payload = payload, context = AgentParseContext(fallbackAgent = "codex"))
        val event = parsed as ParsedAgentEvent.Thinking
        assertEquals(ChatItem.Thinking(content = "Let me analyze...", turnId = "turn_1", ephemeral = false, done = false, agent = "claude"), event.item)
        assertEquals(false, event.done)
    }

    @Test
    fun `Claude tool_call running fixture 解析为 RUNNING 事件`() {
        val payload = """{"tool":"Read","params":{"file_path":"src/main.kt"},"status":"running","toolUseId":"tu_001","agent":"claude"}"""
        val parsed = parser.parse(type = "tool_call", payload = payload)
        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals("Read", event.item.tool)
        assertEquals(ToolCallStatus.RUNNING, event.item.status)
        assertEquals("tu_001", event.item.toolUseId)
        assertEquals("claude", event.item.agent)
        assertTrue(event.paramsSummary.isNotBlank())
    }

    @Test
    fun `Claude tool_call done fixture 归一化为 SUCCESS`() {
        val payload = """{"tool":"Read","params":{},"result":"file contents...","status":"done","toolUseId":"tu_001","agent":"claude"}"""
        val parsed = parser.parse(type = "tool_call", payload = payload)
        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals(ToolCallStatus.SUCCESS, event.item.status)
        assertEquals("file contents...", event.item.result)
        assertEquals("tu_001", event.item.toolUseId)
    }

    @Test
    fun `tool_call pending approval fixture 归一化为 AWAITING_APPROVAL`() {
        val payload = """{"tool":"Edit","params":{"path":"src/app.ts"},"status":"pending_approval","toolUseId":"tu_wait","agent":"codex"}"""
        val parsed = parser.parse(type = "tool_call", payload = payload)
        val event = parsed as ParsedAgentEvent.ToolCall
        assertEquals(ToolCallStatus.AWAITING_APPROVAL, event.item.status)
        assertEquals("tu_wait", event.item.toolUseId)
        assertTrue(event.paramsSummary.contains("src/app.ts"))
    }

    @Test
    fun `Claude approval fixture 解析为编辑型审批`() {
        val payload = """{"id":"apv_001","description":"Write file src/index.ts","tool":"Write","affectedFiles":["src/index.ts"],"riskLevel":"medium","riskSummary":"File modification","permissionMode":"default"}"""
        val parsed = parser.parse(type = "approval_req", payload = payload, context = AgentParseContext(fallbackAgent = "claude"))
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
    fun `approval_req keeps optional taskId`() {
        val payload = """{"id":"apv_task_1","taskId":"task_123","description":"Patch file","tool":"Edit","affectedFiles":["src/app.ts"],"riskLevel":"high"}"""
        val parsed = parser.parse(type = "approval_req", payload = payload)
        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("task_123", event.item.taskId)
    }

    @Test
    fun `approval_req 保留 preview context 与 diffHighlights`() {
        val payload = """{"id":"apv_002","description":"Patch file","tool":"Edit","affectedFiles":["src/app.ts"],"riskLevel":"high","riskSummary":"Dangerous edit","preview":"@@ -1 +1 @@\n-old\n+new","context":"cwd=/repo","permissionMode":"bypass","diffHighlights":["+new line","-old line"],"agent":"claude"}"""
        val parsed = parser.parse(type = "approval_req", payload = payload)
        val event = parsed as ParsedAgentEvent.ApprovalRequest
        assertEquals("@@ -1 +1 @@\n-old\n+new", event.item.preview)
        assertEquals("cwd=/repo", event.item.context)
        assertEquals("bypass", event.item.permissionMode)
        assertEquals(listOf("+new line", "-old line"), event.item.diffHighlights)
        assertEquals("claude", event.item.agent)
    }

    @Test
    fun `Claude file_diff fixture 解析为 FileDiff 事件`() {
        val payload = """{"path":"src/index.ts","diff":"@@ -1,3 +1,5 @@\n+import { foo } from './foo'\n ...","action":"modified"}"""
        val parsed = parser.parse(type = "file_diff", payload = payload, context = AgentParseContext(fallbackAgent = "claude"))
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
        val parsed = parser.parse(type = "approval_req", payload = payload, context = AgentParseContext(fallbackAgent = "codex"))
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
        assertEquals(ToolCallStatus.RUNNING, event.item.status)
        assertEquals("tu_g1", event.item.toolUseId)
        assertEquals("gemini", event.item.agent)
        assertTrue(event.paramsSummary.contains("src/app.ts"))
    }

    @Test
    fun `Gemini approval fixture 解析为高风险编辑审批`() {
        val payload = """{"id":"apv_g1","description":"Edit file src/app.ts","tool":"WriteFile","affectedFiles":["src/app.ts"],"riskLevel":"high","riskSummary":"File creation"}"""
        val parsed = parser.parse(type = "approval_req", payload = payload, context = AgentParseContext(fallbackAgent = "gemini"))
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
        val parsed = parser.parse(type = "approval_req", payload = payload, context = AgentParseContext(envelopeId = "env_123", fallbackAgent = "claude"))
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
        val parsed = parser.parse(type = "usage_report", payload = payload, context = AgentParseContext(fallbackAgent = "gemini"))
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
    fun `turn_state fixture 解析状态与版本`() {
        val payload = """{"phase":"running","version":7,"reason":"tool_call","updatedAt":12345,"runningTasks":2,"pendingApprovals":1}"""
        val parsed = parser.parse(type = "turn_state", payload = payload)
        val event = parsed as ParsedAgentEvent.TurnStateUpdate
        assertEquals("running", event.phase)
        assertEquals(7, event.version)
        assertEquals("tool_call", event.reason)
        assertEquals(12345L, event.updatedAt)
        assertEquals(2, event.runningTasks)
        assertEquals(1, event.pendingApprovals)
    }

    @Test
    fun `interaction_state fixture 解析可用动作和风险信息`() {
        val payload = """{"state":"waiting_approval","version":4,"reason":"approval_requested","updatedAt":45678,"runningTasks":1,"pendingApprovals":2,"availableActions":["approve","reject"],"activeApprovalId":"apv_9","riskLevel":"high","riskSummary":"Shell command","diffHighlights":["+ rm -rf"],"lastError":""}"""
        val parsed = parser.parse(type = "interaction_state", payload = payload)
        val event = parsed as ParsedAgentEvent.InteractionStateUpdate
        assertEquals("waiting_approval", event.phase)
        assertEquals(4, event.version)
        assertEquals("approval_requested", event.reason)
        assertEquals(listOf("approve", "reject"), event.availableActions)
        assertEquals("apv_9", event.activeApprovalId)
        assertEquals("high", event.riskLevel)
        assertEquals(listOf("+ rm -rf"), event.diffHighlights)
    }

    @Test
    fun `foreground_probe_ack fixture 保留前台探测状态`() {
        val payload = """{"probeId":"probe_1","clientTs":11,"serverTs":22,"sessionId":"session_1","status":"running","cwd":"/repo","turnStateVersion":6,"turnStateReason":"streaming","runningTasks":1,"pendingApprovals":0,"permissionMode":"default","modelMode":"fast"}"""
        val parsed = parser.parse(type = "foreground_probe_ack", payload = payload)
        val event = parsed as ParsedAgentEvent.ForegroundProbeAck
        assertEquals("probe_1", event.probeId)
        assertEquals(11L, event.clientTs)
        assertEquals(22L, event.serverTs)
        assertEquals("session_1", event.sessionId)
        assertEquals("running", event.status)
        assertEquals("/repo", event.cwd)
        assertEquals(6, event.turnStateVersion)
        assertEquals("streaming", event.turnStateReason)
        assertEquals("default", event.permissionMode)
        assertEquals("fast", event.modelMode)
    }

    @Test
    fun `replay_done fixture 解析恢复统计`() {
        val payload = """{"sessionId":"session_1","replayed":12,"daemonCached":3,"rounds":2,"reason":"manual","at":98765}"""
        val parsed = parser.parse(type = "replay_done", payload = payload)
        val event = parsed as ParsedAgentEvent.ReplayDone
        assertEquals("session_1", event.sessionId)
        assertEquals(12, event.replayed)
        assertEquals(3, event.daemonCached)
        assertEquals(2, event.rounds)
        assertEquals("manual", event.reason)
        assertEquals(98765L, event.at)
    }

    @Test
    fun `task_queue_status fixture 解析队列与运行中任务`() {
        val payload = """{"queued":[{"id":"q1","prompt":"fix ci","agent":"codex","priority":80,"createdAt":1700000000000},{"id":"q2","prompt":"write docs","priority":10,"createdAt":1700000001000}],"running":["task_a","task_b"],"mode":"parallel"}"""
        val parsed = parser.parse(type = "task_queue_status", payload = payload)
        val event = parsed as ParsedAgentEvent.TaskQueueStatusUpdate
        assertEquals(2, event.queued.size)
        assertEquals("q1", event.queued[0].id)
        assertEquals("fix ci", event.queued[0].prompt)
        assertEquals("codex", event.queued[0].agent)
        assertEquals(80, event.queued[0].priority)
        assertEquals(1700000000000L, event.queued[0].createdAt)
        assertEquals(listOf("task_a", "task_b"), event.running)
        assertEquals("parallel", event.mode)
    }

    @Test
    fun `task_summary fixture 解析耗时 diff 与 token 用量`() {
        val payload = """{"taskId":"task_42","duration":3200,"gitDiff":{"stat":"2 files changed","filesChanged":2,"insertions":12,"deletions":3},"usage":{"inputTokens":1200,"outputTokens":340,"cacheCreationTokens":50,"cacheReadTokens":70}}"""
        val parsed = parser.parse(type = "task_summary", payload = payload)
        val event = parsed as ParsedAgentEvent.TaskSummaryUpdate
        assertEquals("task_42", event.taskId)
        assertEquals(3200L, event.durationMs)
        assertEquals("2 files changed", event.gitStat)
        assertEquals(2, event.filesChanged)
        assertEquals(12, event.insertions)
        assertEquals(3, event.deletions)
        assertEquals(1200, event.inputTokens)
        assertEquals(340, event.outputTokens)
        assertEquals(50, event.cacheCreationTokens)
        assertEquals(70, event.cacheReadTokens)
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


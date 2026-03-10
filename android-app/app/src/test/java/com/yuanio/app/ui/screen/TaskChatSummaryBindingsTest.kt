package com.yuanio.app.ui.screen

import com.yuanio.app.data.ChatHistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TaskChatSummaryBindingsTest {
    @Test
    fun `home bindings resolve latest task result and approval previews`() {
        val entries = listOf(
            ChatHistoryEntry(type = "user", content = "build home", taskId = "task_home", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "home done", taskId = "task_home", ts = 20L),
            ChatHistoryEntry(type = "ai", content = "result ready", taskId = "task_result", ts = 30L),
            ChatHistoryEntry(type = "ai", content = "approval context", taskId = "task_approval", ts = 40L),
        )

        val binding = resolveHomeTaskChatPreviewBinding(
            entries = entries,
            latestTaskId = "task_home",
            latestResultTaskId = "task_result",
            pendingApprovalTaskId = "task_approval",
        )

        assertEquals("home done", binding.latestTaskPreview?.summary)
        assertEquals("result ready", binding.latestResultPreview?.summary)
        assertEquals("approval context", binding.pendingApprovalTaskPreview?.summary)
    }

    @Test
    fun `home bindings return null previews when ids are blank`() {
        val binding = resolveHomeTaskChatPreviewBinding(
            entries = emptyList(),
            latestTaskId = " ",
            latestResultTaskId = null,
            pendingApprovalTaskId = "",
        )

        assertNull(binding.latestTaskPreview)
        assertNull(binding.latestResultPreview)
        assertNull(binding.pendingApprovalTaskPreview)
    }

    @Test
    fun `result binding uses selected task id`() {
        val entries = listOf(
            ChatHistoryEntry(type = "ai", content = "task one", taskId = "task_1", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "task two latest", taskId = "task_2", ts = 20L),
        )

        val preview = resolveResultTaskChatPreview(entries, "task_2")

        assertEquals("task two latest", preview?.summary)
    }

    @Test
    fun `approval binding uses last result task id`() {
        val entries = listOf(
            ChatHistoryEntry(type = "ai", content = "approval result chat", taskId = "task_after_approval", ts = 10L),
        )

        val preview = resolveApprovalTaskChatPreview(entries, "task_after_approval")

        assertEquals("approval result chat", preview?.summary)
    }
}

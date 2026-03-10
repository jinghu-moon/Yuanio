package com.yuanio.app.ui.screen

import com.yuanio.app.data.ChatHistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TaskChatTimelineTest {
    @Test
    fun `activity map keeps latest entry for each task`() {
        val entries = listOf(
            ChatHistoryEntry(type = "user", content = "start", taskId = "task_a", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "done", taskId = "task_a", ts = 30L, agent = "codex"),
            ChatHistoryEntry(type = "user", content = "next", taskId = "task_b", ts = 20L),
        )

        val map = buildTaskChatActivityMap(entries)

        assertEquals("done", map["task_a"]?.summary)
        assertEquals(30L, map["task_a"]?.ts)
        assertEquals("next", map["task_b"]?.summary)
    }

    @Test
    fun `task activity timeline falls back to slash command when explicit task missing`() {
        val entries = listOf(
            ChatHistoryEntry(type = "user", content = "/task task_cmd_123456", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "output", ts = 20L),
        )

        val timeline = buildTaskChatTimeline(entries, "task_cmd_123456")

        assertEquals(listOf("output", "/task task_cmd_123456"), timeline.map { it.summary })
    }

    @Test
    fun `task activity timeline ignores entries from other tasks`() {
        val entries = listOf(
            ChatHistoryEntry(type = "user", content = "A1", taskId = "task_a", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "B1", taskId = "task_b", ts = 20L),
        )

        val timeline = buildTaskChatTimeline(entries, "task_a")

        assertEquals(1, timeline.size)
        assertEquals("A1", timeline.first().summary)
    }

    @Test
    fun `task activity preview returns latest summary for task`() {
        val entries = listOf(
            ChatHistoryEntry(type = "ai", content = "older", taskId = "task_a", ts = 10L),
            ChatHistoryEntry(type = "ai", content = "latest", taskId = "task_a", ts = 30L),
        )

        assertEquals("latest", resolveTaskChatPreview(entries, "task_a")?.summary)
    }

    @Test
    fun `task activity preview returns null when task missing`() {
        assertNull(resolveTaskChatPreview(emptyList(), "task_missing"))
    }
}

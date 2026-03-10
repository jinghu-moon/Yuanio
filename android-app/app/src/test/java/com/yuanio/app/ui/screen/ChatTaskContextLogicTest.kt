package com.yuanio.app.ui.screen

import com.yuanio.app.ui.model.ChatItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatTaskContextLogicTest {
    @Test
    fun `normal prompt inherits current task context`() {
        assertEquals(
            "task_ctx_123456",
            resolveOutgoingChatTextTaskId(
                currentTaskId = "task_ctx_123456",
                text = "continue",
            ),
        )
    }

    @Test
    fun `task slash command overrides current task context`() {
        assertEquals(
            "task_cmd_654321",
            resolveOutgoingChatTextTaskId(
                currentTaskId = "task_ctx_123456",
                text = "/task task_cmd_654321",
            ),
        )
    }

    @Test
    fun `history task resolution prefers explicit task field from latest message`() {
        val history = listOf(
            ChatItem.Text(role = "ai", content = "/task task_old_111111"),
            ChatItem.Text(role = "user", content = "done", taskId = "task_new_222222"),
        )

        assertEquals("task_new_222222", resolveLatestHistoryTaskId(history))
    }

    @Test
    fun `history task resolution returns null when no task context exists`() {
        val history = listOf(
            ChatItem.Text(role = "user", content = "hello"),
            ChatItem.Text(role = "ai", content = "world"),
        )

        assertNull(resolveLatestHistoryTaskId(history))
    }

    @Test
    fun `stream merge updates trailing ai item and preserves explicit task`() {
        val items = listOf(
            ChatItem.Text(role = "user", content = "prompt", taskId = "task_ctx_123456"),
            ChatItem.Text(role = "ai", content = "old", taskId = "task_ai_999999", agent = "codex"),
        )

        val merged = mergeStreamingChatText(
            current = items,
            content = "new content",
            currentAgent = "gemini",
            currentTaskId = "task_ctx_123456",
        )

        val last = merged.last() as ChatItem.Text
        assertEquals("new content", last.content)
        assertEquals("task_ai_999999", last.taskId)
        assertEquals("gemini", last.agent)
    }

    @Test
    fun `stream merge appends ai item with current task when trailing item is not ai`() {
        val items = listOf(
            ChatItem.Text(role = "user", content = "prompt", taskId = "task_ctx_123456"),
        )

        val merged = mergeStreamingChatText(
            current = items,
            content = "assistant content",
            currentAgent = "codex",
            currentTaskId = "task_ctx_123456",
        )

        val last = merged.last() as ChatItem.Text
        assertEquals("assistant content", last.content)
        assertEquals("task_ctx_123456", last.taskId)
        assertEquals("codex", last.agent)
    }
}

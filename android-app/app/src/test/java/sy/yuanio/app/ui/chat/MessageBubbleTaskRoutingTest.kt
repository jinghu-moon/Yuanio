package sy.yuanio.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageBubbleTaskRoutingTest {
    @Test
    fun `artifact task prefers explicit message task`() {
        val resolved = resolveArtifactTaskId(
            messageTaskId = "task_explicit_123",
            preferredArtifactTaskId = "task_route_456",
            content = "/task task_content_789",
        )

        assertEquals("task_explicit_123", resolved)
    }

    @Test
    fun `artifact task falls back to route then content`() {
        assertEquals(
            "task_route_456",
            resolveArtifactTaskId(
                messageTaskId = null,
                preferredArtifactTaskId = "task_route_456",
                content = "/task task_content_789",
            ),
        )
        assertEquals(
            "task_content_789",
            resolveArtifactTaskId(
                messageTaskId = null,
                preferredArtifactTaskId = null,
                content = "/task task_content_789",
            ),
        )
    }

    @Test
    fun `message task list puts explicit task first and deduplicates`() {
        val resolved = resolveMessageTaskIds(
            messageTaskId = "task_explicit_123",
            content = """
                /task task_explicit_123
                /task task_other_456
            """.trimIndent(),
        )

        assertEquals(listOf("task_explicit_123", "task_other_456"), resolved)
    }
}


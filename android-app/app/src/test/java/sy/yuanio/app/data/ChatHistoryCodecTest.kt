package sy.yuanio.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatHistoryCodecTest {
    @Test
    fun `new schema keeps task and agent fields`() {
        val entries = listOf(
            ChatHistoryEntry(
                type = "user",
                content = "/task task_123456",
                taskId = "task_123456",
                ts = 10L,
            ),
            ChatHistoryEntry(
                type = "ai",
                content = "done",
                taskId = "task_123456",
                agent = "codex",
                ts = 20L,
            ),
        )

        val decoded = decodeChatHistoryEntries(encodeChatHistoryEntries(entries))

        assertEquals(entries, decoded)
    }

    @Test
    fun `legacy schema still decodes to basic entries`() {
        val legacyJson = """
            [
              {"t":"user","c":"hello"},
              {"t":"ai","c":"world"}
            ]
        """.trimIndent()

        val decoded = decodeChatHistoryEntries(legacyJson)

        assertEquals(
            listOf(
                ChatHistoryEntry(type = "user", content = "hello"),
                ChatHistoryEntry(type = "ai", content = "world"),
            ),
            decoded,
        )
    }
}


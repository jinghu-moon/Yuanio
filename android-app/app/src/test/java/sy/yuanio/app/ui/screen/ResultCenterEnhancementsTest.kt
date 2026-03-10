package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.Artifact
import sy.yuanio.app.data.ArtifactType
import sy.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ResultCenterEnhancementsTest {
    @Test
    fun `buildResultShareText includes key metrics and git summary`() {
        val summary = WorkflowTaskSummary(
            taskId = "task_42",
            durationMs = 3200,
            filesChanged = 3,
            insertions = 12,
            deletions = 2,
            inputTokens = 800,
            outputTokens = 200,
            gitStat = "3 files changed",
        )

        val text = buildResultShareText(summary)

        assertTrue(text.contains("task_42"))
        assertTrue(text.contains("3.2s"))
        assertTrue(text.contains("3"))
        assertTrue(text.contains("1000"))
        assertTrue(text.contains("3 files changed"))
        assertTrue(text.contains("+12 / -2"))
    }

    @Test
    fun `buildResultShareText includes recent chat preview when present`() {
        val summary = WorkflowTaskSummary(
            taskId = "task_42",
            durationMs = 3200,
            filesChanged = 3,
            inputTokens = 800,
            outputTokens = 200,
        )

        val text = buildResultShareText(
            summary = summary,
            taskChatPreview = TaskChatActivityEntry(
                taskId = "task_42",
                role = "ai",
                summary = "validated relay restart and cleaned fallback path",
                ts = 100L,
            ),
        )

        assertTrue(text.contains("Recent chat"))
        assertTrue(text.contains("validated relay restart and cleaned fallback path"))
    }

    @Test
    fun `buildResultFollowUpPrompt references task and asks for next step`() {
        val summary = WorkflowTaskSummary(
            taskId = "task_99",
            durationMs = 900,
            filesChanged = 1,
            inputTokens = 120,
            outputTokens = 80,
            gitStat = "1 file changed",
        )

        val prompt = buildResultFollowUpPrompt(summary)

        assertTrue(prompt.contains("task_99"))
        assertTrue(prompt.contains("1. assess"))
        assertTrue(prompt.contains("execute the most reasonable next step"))
        assertTrue(prompt.contains("1 file changed"))
    }

    @Test
    fun `buildArtifactShareText includes artifact metadata and fenced content`() {
        val artifact = Artifact(
            id = "a1",
            type = ArtifactType.HTML,
            lang = "html",
            content = "<section>Hello</section>",
            title = "Landing Hero",
            savedAt = 100L,
        )

        val shareText = buildArtifactShareText(artifact)

        assertTrue(shareText.contains("Landing Hero"))
        assertTrue(shareText.contains("HTML"))
        assertTrue(shareText.contains("html"))
        assertTrue(shareText.contains("```html"))
        assertTrue(shareText.contains("<section>Hello</section>"))
    }

    @Test
    fun `selectRecentArtifacts sorts by savedAt descending and limits size`() {
        val artifacts = listOf(
            Artifact(id = "a1", type = ArtifactType.CODE, lang = "ts", content = "1", savedAt = 10L),
            Artifact(id = "a2", type = ArtifactType.HTML, lang = "html", content = "2", savedAt = 30L),
            Artifact(id = "a3", type = ArtifactType.SVG, lang = "svg", content = "3", savedAt = 20L),
        )

        val selected = selectRecentArtifacts(artifacts, limit = 2)

        assertEquals(listOf("a2", "a3"), selected.map { it.id })
    }
}


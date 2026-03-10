package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.Artifact
import sy.yuanio.app.data.ArtifactType
import sy.yuanio.app.data.WorkflowTaskSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ResultCenterLinksTest {
    @Test
    fun `result file query prefers task id`() {
        val summary = WorkflowTaskSummary(taskId = "task_42", gitStat = "3 files changed")

        val query = buildResultFileQuery(summary)

        assertEquals("task_42", query)
    }

    @Test
    fun `result file query prefers latest task artifact path when available`() {
        val summary = WorkflowTaskSummary(taskId = "task_42", gitStat = "3 files changed")
        val artifacts = listOf(
            Artifact(
                id = "a1",
                type = ArtifactType.CODE,
                lang = "kt",
                content = "fun old() = Unit",
                title = "app/src/Old.kt",
                taskId = "task_42",
                savedAt = 10L,
            ),
            Artifact(
                id = "a2",
                type = ArtifactType.CODE,
                lang = "kt",
                content = "fun latest() = Unit",
                title = "app/src/Latest.kt",
                taskId = "task_42",
                savedAt = 20L,
            ),
        )

        val query = buildResultFileQuery(summary, artifacts)

        assertEquals("app/src/Latest.kt", query)
    }

    @Test
    fun `result file query returns null when summary missing`() {
        assertNull(buildResultFileQuery(null))
    }

    @Test
    fun `result artifact file query prefers title`() {
        val artifact = Artifact(
            id = "a1",
            type = ArtifactType.CODE,
            lang = "kt",
            content = "fun main() {}",
            title = "app/src/main/MainActivity.kt",
        )

        assertEquals("app/src/main/MainActivity.kt", buildResultArtifactFileQuery(artifact))
    }

    @Test
    fun `result artifact file query falls back to language and content`() {
        val languageFallback = Artifact(
            id = "a2",
            type = ArtifactType.CODE,
            lang = "ts",
            content = "export const ok = true",
            title = "",
        )
        val contentFallback = Artifact(
            id = "a3",
            type = ArtifactType.CODE,
            lang = "",
            content = "README.md\nsecond line",
            title = "",
        )

        assertEquals("ts", buildResultArtifactFileQuery(languageFallback))
        assertEquals("README.md", buildResultArtifactFileQuery(contentFallback))
    }

    @Test
    fun `artifact origin target prefers explicit task and session`() {
        val artifact = Artifact(
            id = "a4",
            type = ArtifactType.HTML,
            lang = "html",
            content = "<div/>",
            taskId = "task_99",
            sessionId = "session_77",
            sourceHint = "codex",
        )

        val target = resolveResultArtifactOriginTarget(artifact, fallbackTaskId = "task_fallback")

        assertEquals("task_99", target?.taskId)
        assertEquals("session_77", target?.sessionId)
    }

    @Test
    fun `artifact origin target falls back to selected task`() {
        val artifact = Artifact(
            id = "a5",
            type = ArtifactType.SVG,
            lang = "svg",
            content = "<svg/>",
        )

        val target = resolveResultArtifactOriginTarget(artifact, fallbackTaskId = "task_selected")

        assertEquals("task_selected", target?.taskId)
        assertNull(target?.sessionId)
    }

    @Test
    fun `artifact file task context prefers artifact task id`() {
        val artifact = Artifact(
            id = "a_ctx",
            type = ArtifactType.CODE,
            lang = "kt",
            content = "fun context() = Unit",
            title = "app/src/Context.kt",
            taskId = "task_artifact",
        )

        assertEquals("task_artifact", resolveResultArtifactTaskId(artifact, fallbackTaskId = "task_selected"))
    }

    @Test
    fun `artifact origin summary includes source task and session`() {
        val artifact = Artifact(
            id = "a6",
            type = ArtifactType.MERMAID,
            lang = "mermaid",
            content = "graph TD",
            taskId = "task_mermaid",
            sessionId = "session_mermaid",
            sourceHint = "gemini",
        )

        val summary = buildResultArtifactOriginSummary(artifact)

        assertEquals("gemini ? task_mermaid ? session_mermaid", summary)
    }

    @Test
    fun `result git tab prefers status when files changed exist`() {
        val summary = WorkflowTaskSummary(taskId = "task_42", filesChanged = 2)

        val tab = resolveResultGitTab(summary)

        assertEquals(ResultGitTab.STATUS, tab)
    }

    @Test
    fun `result git tab falls back to log when no file change`() {
        val summary = WorkflowTaskSummary(taskId = "task_42", filesChanged = 0)

        val tab = resolveResultGitTab(summary)

        assertEquals(ResultGitTab.LOG, tab)
    }

    @Test
    fun `result git tab prefers status when task artifacts exist`() {
        val summary = WorkflowTaskSummary(taskId = "task_42", filesChanged = 0)
        val artifacts = listOf(
            Artifact(
                id = "a_status",
                type = ArtifactType.HTML,
                lang = "html",
                content = "<div />",
                title = "dist/index.html",
                taskId = "task_42",
            ),
        )

        val tab = resolveResultGitTab(summary, artifacts)

        assertEquals(ResultGitTab.STATUS, tab)
    }
}


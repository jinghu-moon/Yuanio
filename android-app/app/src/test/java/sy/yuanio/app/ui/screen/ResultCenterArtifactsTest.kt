package sy.yuanio.app.ui.screen

import sy.yuanio.app.data.Artifact
import sy.yuanio.app.data.ArtifactType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ResultCenterArtifactsTest {
    @Test
    fun `all filter keeps artifacts when query empty`() {
        val artifacts = sampleArtifacts()

        val result = filterResultArtifacts(
            artifacts = artifacts,
            query = "",
            mode = ResultArtifactFilterMode.ALL,
        )

        assertEquals(4, result.size)
    }

    @Test
    fun `query filters artifacts by title lang and content`() {
        val artifacts = sampleArtifacts()

        val result = filterResultArtifacts(
            artifacts = artifacts,
            query = "mermaid",
            mode = ResultArtifactFilterMode.ALL,
        )

        assertEquals(listOf("a4"), result.map { it.id })
    }

    @Test
    fun `type filter keeps only matching artifact type`() {
        val artifacts = sampleArtifacts()

        val result = filterResultArtifacts(
            artifacts = artifacts,
            query = "",
            mode = ResultArtifactFilterMode.HTML,
        )

        assertEquals(listOf("a2"), result.map { it.id })
    }

    @Test
    fun `artifact stats summarize total and per type counts`() {
        val stats = buildResultArtifactStats(sampleArtifacts())

        assertEquals(4, stats.totalCount)
        assertEquals(1, stats.codeCount)
        assertEquals(1, stats.htmlCount)
        assertEquals(1, stats.svgCount)
        assertEquals(1, stats.mermaidCount)
        assertEquals(3, stats.visualCount)
    }

    @Test
    fun `group artifacts keeps canonical type order and drops empty groups`() {
        val grouped = groupResultArtifacts(sampleArtifacts())

        assertEquals(
            listOf(
                ResultArtifactFilterMode.CODE,
                ResultArtifactFilterMode.HTML,
                ResultArtifactFilterMode.SVG,
                ResultArtifactFilterMode.MERMAID,
            ),
            grouped.map { it.filterMode },
        )
        assertEquals(listOf(1, 1, 1, 1), grouped.map { it.artifacts.size })
    }


    @Test
    fun `filter artifacts for task keeps only matching task origin`() {
        val artifacts = listOf(
            Artifact(id = "a1", type = ArtifactType.CODE, lang = "kt", content = "1", taskId = "task_a", savedAt = 10L),
            Artifact(id = "a2", type = ArtifactType.HTML, lang = "html", content = "2", taskId = "task_b", savedAt = 30L),
            Artifact(id = "a3", type = ArtifactType.SVG, lang = "svg", content = "3", taskId = "task_a", savedAt = 20L),
        )

        val filtered = filterArtifactsForTask(artifacts, "task_a")

        assertEquals(listOf("a3", "a1"), filtered.map { it.id })
    }

    @Test
    fun `resolve artifact title falls back to language and type`() {
        assertEquals(
            "ts",
            resolveResultArtifactTitle(
                Artifact(id = "lang", type = ArtifactType.CODE, lang = "ts", content = "const a = 1", title = ""),
            ),
        )
        assertEquals(
            "HTML",
            resolveResultArtifactTitle(
                Artifact(id = "type", type = ArtifactType.HTML, lang = "", content = "<div></div>", title = ""),
            ),
        )
    }

    @Test
    fun `resolve artifact type label uses readable values`() {
        assertEquals(
            "kt",
            resolveResultArtifactTypeLabel(
                Artifact(id = "code", type = ArtifactType.CODE, lang = "kt", content = "fun main() {}", title = ""),
            ),
        )
        assertEquals(
            "Mermaid",
            resolveResultArtifactTypeLabel(
                Artifact(id = "mermaid", type = ArtifactType.MERMAID, lang = "", content = "graph TD", title = ""),
            ),
        )
    }

    @Test
    fun `latest artifact summary returns newest saved item`() {
        val summary = selectLatestResultArtifact(sampleArtifacts())

        assertEquals("a4", summary?.id)
    }

    @Test
    fun `latest artifact summary returns null when list empty`() {
        assertNull(selectLatestResultArtifact(emptyList()))
    }

    private fun sampleArtifacts(): List<Artifact> {
        return listOf(
            Artifact(id = "a1", type = ArtifactType.CODE, lang = "kt", content = "fun main() {}", title = "Kotlin snippet", savedAt = 10L),
            Artifact(id = "a2", type = ArtifactType.HTML, lang = "html", content = "<div>dashboard</div>", title = "Dashboard", savedAt = 20L),
            Artifact(id = "a3", type = ArtifactType.SVG, lang = "svg", content = "<svg></svg>", title = "Icon", savedAt = 30L),
            Artifact(id = "a4", type = ArtifactType.MERMAID, lang = "mermaid", content = "graph TD; A-->B", title = "Mermaid Flow", savedAt = 40L),
        )
    }
}


package com.yuanio.app.ui.screen

import com.yuanio.app.data.Artifact
import com.yuanio.app.data.ArtifactType

internal enum class ResultCenterMode(val routeValue: String) {
    SUMMARY("summary"),
    ARTIFACTS("artifacts"),
}

internal enum class ResultArtifactFilterMode {
    ALL,
    CODE,
    HTML,
    SVG,
    MERMAID,
}

internal data class ResultArtifactStats(
    val totalCount: Int,
    val codeCount: Int,
    val htmlCount: Int,
    val svgCount: Int,
    val mermaidCount: Int,
    val visualCount: Int,
)

internal data class ResultArtifactSection(
    val filterMode: ResultArtifactFilterMode,
    val artifacts: List<Artifact>,
)

internal fun resolveResultCenterMode(requestedMode: String?): ResultCenterMode {
    return when (requestedMode?.trim()?.lowercase()) {
        ResultCenterMode.ARTIFACTS.routeValue -> ResultCenterMode.ARTIFACTS
        else -> ResultCenterMode.SUMMARY
    }
}

internal fun filterResultArtifacts(
    artifacts: List<Artifact>,
    query: String,
    mode: ResultArtifactFilterMode,
): List<Artifact> {
    val normalizedQuery = query.trim().lowercase()
    return artifacts.filter { artifact ->
        val queryMatches = normalizedQuery.isBlank() || listOf(
            artifact.id,
            artifact.title,
            artifact.lang,
            artifact.type.name,
            artifact.content,
            artifact.taskId.orEmpty(),
            artifact.sessionId.orEmpty(),
            artifact.sourceHint.orEmpty(),
        ).any { it.lowercase().contains(normalizedQuery) }
        val modeMatches = when (mode) {
            ResultArtifactFilterMode.ALL -> true
            ResultArtifactFilterMode.CODE -> artifact.type == ArtifactType.CODE
            ResultArtifactFilterMode.HTML -> artifact.type == ArtifactType.HTML
            ResultArtifactFilterMode.SVG -> artifact.type == ArtifactType.SVG
            ResultArtifactFilterMode.MERMAID -> artifact.type == ArtifactType.MERMAID
        }
        queryMatches && modeMatches
    }.sortedByDescending { it.savedAt }
}

internal fun filterArtifactsForTask(
    artifacts: List<Artifact>,
    taskId: String?,
): List<Artifact> {
    val normalizedTaskId = taskId?.trim().orEmpty()
    if (normalizedTaskId.isBlank()) return emptyList()
    return artifacts
        .filter { it.taskId == normalizedTaskId }
        .sortedByDescending { it.savedAt }
}

internal fun buildResultArtifactStats(artifacts: List<Artifact>): ResultArtifactStats {
    val codeCount = artifacts.count { it.type == ArtifactType.CODE }
    val htmlCount = artifacts.count { it.type == ArtifactType.HTML }
    val svgCount = artifacts.count { it.type == ArtifactType.SVG }
    val mermaidCount = artifacts.count { it.type == ArtifactType.MERMAID }
    val visualCount = htmlCount + svgCount + mermaidCount
    return ResultArtifactStats(
        totalCount = artifacts.size,
        codeCount = codeCount,
        htmlCount = htmlCount,
        svgCount = svgCount,
        mermaidCount = mermaidCount,
        visualCount = visualCount,
    )
}

internal fun groupResultArtifacts(artifacts: List<Artifact>): List<ResultArtifactSection> {
    return listOf(
        ResultArtifactFilterMode.CODE,
        ResultArtifactFilterMode.HTML,
        ResultArtifactFilterMode.SVG,
        ResultArtifactFilterMode.MERMAID,
    ).mapNotNull { mode ->
        val groupedArtifacts = filterResultArtifacts(artifacts, query = "", mode = mode)
        if (groupedArtifacts.isEmpty()) {
            null
        } else {
            ResultArtifactSection(filterMode = mode, artifacts = groupedArtifacts)
        }
    }
}

internal fun resolveResultArtifactTitle(artifact: Artifact): String {
    return artifact.title.ifBlank {
        artifact.lang.ifBlank { resolveResultArtifactTypeLabel(artifact) }
    }
}

internal fun resolveResultArtifactTypeLabel(artifact: Artifact): String {
    return when (artifact.type) {
        ArtifactType.HTML -> "HTML"
        ArtifactType.SVG -> "SVG"
        ArtifactType.MERMAID -> "Mermaid"
        ArtifactType.CODE -> artifact.lang.ifBlank { "Code" }
    }
}

internal fun selectLatestResultArtifact(artifacts: List<Artifact>): Artifact? {
    return artifacts.maxByOrNull { it.savedAt }
}

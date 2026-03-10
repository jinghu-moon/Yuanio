package com.yuanio.app.ui.screen

import com.yuanio.app.data.Artifact
import com.yuanio.app.data.WorkflowTaskSummary

internal enum class ResultGitTab(val routeValue: String) {
    STATUS("status"),
    LOG("log"),
}

internal data class ResultArtifactOriginTarget(
    val sessionId: String? = null,
    val taskId: String? = null,
)

internal fun buildResultFileQuery(
    summary: WorkflowTaskSummary?,
    artifacts: List<Artifact> = emptyList(),
): String? {
    val taskId = summary?.taskId?.trim().orEmpty()
    if (taskId.isBlank()) return null
    val latestArtifact = artifacts
        .filter { it.taskId?.trim() == taskId }
        .maxByOrNull { it.savedAt }
    val artifactQuery = latestArtifact?.let(::buildResultArtifactFileQuery)
    return artifactQuery?.takeIf { it.isNotBlank() } ?: taskId
}

internal fun buildResultArtifactFileQuery(artifact: Artifact): String? {
    val title = artifact.title.trim()
    if (title.isNotBlank()) return title
    val lang = artifact.lang.trim()
    if (lang.isNotBlank()) return lang
    val firstContentLine = artifact.content
        .lineSequence()
        .map { it.trim() }
        .firstOrNull { it.isNotBlank() }
    return firstContentLine?.take(80)
}

internal fun resolveResultArtifactOriginTarget(
    artifact: Artifact,
    fallbackTaskId: String? = null,
): ResultArtifactOriginTarget? {
    val taskId = resolveResultArtifactTaskId(artifact, fallbackTaskId)
    val sessionId = artifact.sessionId?.trim().orEmpty().ifBlank { null }
    if (taskId == null && sessionId == null) return null
    return ResultArtifactOriginTarget(sessionId = sessionId, taskId = taskId)
}

internal fun buildResultArtifactOriginSummary(artifact: Artifact): String? {
    val parts = buildList {
        artifact.sourceHint?.trim()?.takeIf { it.isNotBlank() }?.let(::add)
        artifact.taskId?.trim()?.takeIf { it.isNotBlank() }?.let(::add)
        artifact.sessionId?.trim()?.takeIf { it.isNotBlank() }?.let(::add)
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(separator = " ? ")
}

internal fun resolveResultArtifactTaskId(artifact: Artifact, fallbackTaskId: String? = null): String? {
    return artifact.taskId?.trim().orEmpty().ifBlank {
        fallbackTaskId?.trim().orEmpty()
    }.ifBlank { null }
}

internal fun resolveResultGitTab(
    summary: WorkflowTaskSummary?,
    artifacts: List<Artifact> = emptyList(),
): ResultGitTab {
    if (summary == null) return ResultGitTab.LOG
    return if (summary.filesChanged > 0 || summary.insertions > 0 || summary.deletions > 0) {
        ResultGitTab.STATUS
    } else if (artifacts.any { it.taskId?.trim() == summary.taskId }) {
        ResultGitTab.STATUS
    } else {
        ResultGitTab.LOG
    }
}

package com.yuanio.app.ui.screen

import com.yuanio.app.data.Artifact
import com.yuanio.app.data.WorkflowTaskSummary

internal fun buildResultShareText(summary: WorkflowTaskSummary): String {
    return buildResultShareText(summary = summary, taskChatPreview = null)
}

internal fun buildResultShareText(
    summary: WorkflowTaskSummary,
    taskChatPreview: TaskChatActivityEntry? = null,
): String {
    return buildString {
        appendLine("# Yuanio Result Summary")
        appendLine()
        appendLine("- Task: ${summary.taskId}")
        appendLine("- Duration: ${formatResultEnhancementDuration(summary.durationMs)}")
        appendLine("- Files changed: ${summary.filesChanged}")
        appendLine("- Total tokens: ${summary.totalTokens}")
        taskChatPreview?.summary?.trim()?.takeIf { it.isNotBlank() }?.let {
            appendLine("- Recent chat: $it")
        }
        if (summary.gitStat.isNotBlank()) {
            appendLine("- Git: ${summary.gitStat}")
        }
        if (summary.insertions > 0 || summary.deletions > 0) {
            appendLine("- Diff: +${summary.insertions} / -${summary.deletions}")
        }
    }.trim()
}

internal fun buildArtifactShareText(artifact: Artifact): String {
    val fenceLang = artifact.lang.ifBlank { artifact.type.name.lowercase() }
    return buildString {
        appendLine("# Yuanio Artifact")
        appendLine()
        appendLine("- Title: ${resolveResultArtifactTitle(artifact)}")
        appendLine("- Type: ${resolveResultArtifactTypeLabel(artifact)}")
        if (artifact.lang.isNotBlank()) {
            appendLine("- Language: ${artifact.lang}")
        }
        appendLine()
        appendLine("```$fenceLang")
        appendLine(artifact.content)
        appendLine("```")
    }.trim()
}

internal fun buildResultFollowUpPrompt(summary: WorkflowTaskSummary): String {
    val gitLine = if (summary.gitStat.isNotBlank()) {
        "- Git summary: ${summary.gitStat}"
    } else {
        "- Git summary: unavailable"
    }
    return """
        Follow up on task ${summary.taskId}.
        Current result snapshot:
        - Duration: ${formatResultEnhancementDuration(summary.durationMs)}
        - Files changed: ${summary.filesChanged}
        - Total tokens: ${summary.totalTokens}
        $gitLine

        Based on this result:
        1. assess whether the task is complete,
        2. identify any missing validation or risks,
        3. execute the most reasonable next step.
    """.trimIndent()
}

internal fun selectRecentArtifacts(
    artifacts: List<Artifact>,
    limit: Int = 3,
): List<Artifact> {
    if (limit <= 0) return emptyList()
    return artifacts.sortedByDescending { it.savedAt }.take(limit)
}

internal fun formatResultEnhancementDuration(durationMs: Long): String {
    if (durationMs <= 0L) return "0ms"
    return if (durationMs < 1000L) {
        "${durationMs}ms"
    } else {
        String.format("%.1fs", durationMs / 1000f)
    }
}

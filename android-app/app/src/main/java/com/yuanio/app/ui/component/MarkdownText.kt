package com.yuanio.app.ui.component

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.mikepenz.markdown.m3.Markdown
import com.yuanio.app.data.ArtifactType

/**
 * 原生 Markdown 渲染（Compose 节点，不使用 WebView）。
 * 仅在检测到 HTML/SVG/Mermaid 等 artifact 代码块时分流到 ArtifactCard。
 */
@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier) {
    val blocks = remember(text) { splitCodeBlocks(text) }
    Column(modifier) {
        blocks.forEach { block ->
            if (!block.isCode) {
                Markdown(content = block.content)
            } else {
                val artifactType = ArtifactType.detect(block.lang)
                if (artifactType != ArtifactType.CODE) {
                    ArtifactCard(
                        code = block.content,
                        lang = block.lang,
                        type = artifactType
                    )
                } else {
                    val fenced = buildString {
                        append("```")
                        append(block.lang)
                        append('\n')
                        append(block.content)
                        append("\n```")
                    }
                    Markdown(content = fenced)
                }
            }
        }
    }
}

private data class Block(
    val content: String,
    val isCode: Boolean,
    val lang: String = "",
)

private fun splitCodeBlocks(text: String): List<Block> {
    val blocks = mutableListOf<Block>()
    val regex = Regex("```([^\\n]*)\\n([\\s\\S]*?)```")
    var lastEnd = 0
    for (match in regex.findAll(text)) {
        if (match.range.first > lastEnd) {
            val normalText = text.substring(lastEnd, match.range.first).trim()
            if (normalText.isNotEmpty()) blocks.add(Block(normalText, false))
        }
        blocks.add(
            Block(
                content = match.groupValues[2].trimEnd(),
                isCode = true,
                lang = match.groupValues[1].trim(),
            )
        )
        lastEnd = match.range.last + 1
    }
    if (lastEnd < text.length) {
        val tail = text.substring(lastEnd).trim()
        if (tail.isNotEmpty()) blocks.add(Block(tail, false))
    }
    return if (blocks.isEmpty()) listOf(Block(text, false)) else blocks
}

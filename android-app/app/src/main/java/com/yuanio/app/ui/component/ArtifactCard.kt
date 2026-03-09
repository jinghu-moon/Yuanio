package com.yuanio.app.ui.component

import android.content.ClipData
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yuanio.app.R
import com.yuanio.app.data.Artifact
import com.yuanio.app.data.ArtifactStore
import com.yuanio.app.data.ArtifactType

@Composable
fun ArtifactCard(
    code: String,
    lang: String,
    type: ArtifactType,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val copiedText = stringResource(R.string.common_copied)
    val shareText = stringResource(R.string.common_share)
    val unsavedText = stringResource(R.string.artifact_toast_unsaved)
    val savedText = stringResource(R.string.artifact_toast_saved)
    val artifactId = remember(code) {
        code.hashCode().toUInt().toString(16)
    }
    var isSaved by remember { mutableStateOf(ArtifactStore.isSaved(artifactId)) }
    var expanded by remember { mutableStateOf(true) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh
        )
    ) {
        // Header
        ArtifactHeader(
            lang = lang,
            type = type,
            expanded = expanded,
            isSaved = isSaved,
            onToggle = { expanded = !expanded },
            onCopy = {
                clipboard.nativeClipboard.setPrimaryClip(
                    ClipData.newPlainText("artifact", code)
                )
                Toast.makeText(context, copiedText, Toast.LENGTH_SHORT).show()
            },
            onShare = {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    this.type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, code)
                }
                context.startActivity(Intent.createChooser(intent, shareText))
            },
            onSave = {
                if (isSaved) {
                    ArtifactStore.remove(artifactId)
                    isSaved = false
                    Toast.makeText(context, unsavedText, Toast.LENGTH_SHORT).show()
                } else {
                    ArtifactStore.save(
                        Artifact(
                            id = artifactId,
                            type = type,
                            lang = lang,
                            content = code,
                            title = lang.ifBlank { type.name }
                        )
                    )
                    isSaved = true
                    Toast.makeText(context, savedText, Toast.LENGTH_SHORT).show()
                }
            }
        )

        // Content
        if (expanded) {
            ArtifactContent(code = code, type = type)
        }
    }
}

@Composable
private fun ArtifactHeader(
    lang: String,
    type: ArtifactType,
    expanded: Boolean,
    isSaved: Boolean,
    onToggle: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onSave: () -> Unit
) {
    val cdCopy = stringResource(R.string.cd_copy)
    val cdShare = stringResource(R.string.cd_share)
    val cdSave = stringResource(R.string.cd_save)
    val cdUnsave = stringResource(R.string.cd_unsave)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 类型标签
        SuggestionChip(
            onClick = onToggle,
            label = {
                Text(
                    when (type) {
                        ArtifactType.HTML -> "HTML"
                        ArtifactType.SVG -> "SVG"
                        ArtifactType.MERMAID -> "Mermaid"
                        ArtifactType.CODE -> lang.ifBlank { "Code" }
                    },
                    fontSize = 11.sp
                )
            }
        )
        Spacer(Modifier.weight(1f))
        // 操作按钮
        IconButton(onClick = onCopy, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_copy),
                contentDescription = cdCopy,
                modifier = Modifier.size(16.dp)
            )
        }
        IconButton(onClick = onShare, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_share),
                contentDescription = cdShare,
                modifier = Modifier.size(16.dp)
            )
        }
        IconButton(onClick = onSave, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(
                    if (isSaved) R.drawable.ic_tb_bookmark_filled
                    else R.drawable.ic_tb_bookmark
                ),
                contentDescription = if (isSaved) cdUnsave else cdSave,
                modifier = Modifier.size(16.dp),
                tint = if (isSaved) MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.outline
            )
        }
    }
}

@Composable
private fun ArtifactContent(code: String, type: ArtifactType) {
    when (type) {
        ArtifactType.HTML, ArtifactType.SVG, ArtifactType.MERMAID -> {
            ArtifactWebView(
                content = code,
                type = type,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
        ArtifactType.CODE -> {
            // CODE 类型不在此渲染，由 MarkdownText 原有 CodeBlock 处理
        }
    }
}

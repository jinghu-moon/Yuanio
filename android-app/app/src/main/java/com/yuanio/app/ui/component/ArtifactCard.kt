package com.yuanio.app.ui.component

import android.content.ClipData
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    modifier: Modifier = Modifier,
    artifactIdOverride: String? = null,
    title: String = "",
    shareText: String? = null,
    taskId: String? = null,
    sessionId: String? = null,
    sourceHint: String? = null,
    onSavedStateChanged: (Boolean) -> Unit = {},
) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val copiedText = stringResource(R.string.common_copied)
    val shareChooserText = stringResource(R.string.common_share)
    val unsavedText = stringResource(R.string.artifact_toast_unsaved)
    val savedText = stringResource(R.string.artifact_toast_saved)
    val artifactId = remember(code, lang, type, title, artifactIdOverride) {
        artifactIdOverride?.trim()?.takeIf { it.isNotBlank() } ?: buildStableArtifactId(
            code = code,
            lang = lang,
            type = type,
            title = title,
        )
    }
    var isSaved by remember(artifactId) { mutableStateOf(ArtifactStore.isSaved(artifactId)) }
    var expanded by remember(code, type) { mutableStateOf(true) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ),
    ) {
        ArtifactHeader(
            lang = lang,
            type = type,
            isSaved = isSaved,
            onToggle = { expanded = !expanded },
            onCopy = {
                clipboard.nativeClipboard.setPrimaryClip(
                    ClipData.newPlainText("artifact", code),
                )
                Toast.makeText(context, copiedText, Toast.LENGTH_SHORT).show()
            },
            onShare = {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    this.type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, shareText ?: code)
                }
                context.startActivity(Intent.createChooser(intent, shareChooserText))
            },
            onSave = {
                if (isSaved) {
                    ArtifactStore.remove(artifactId)
                    isSaved = false
                    onSavedStateChanged(false)
                    Toast.makeText(context, unsavedText, Toast.LENGTH_SHORT).show()
                } else {
                    ArtifactStore.save(
                        Artifact(
                            id = artifactId,
                            type = type,
                            lang = lang,
                            content = code,
                            title = title.ifBlank { lang.ifBlank { type.name } },
                            taskId = taskId?.trim()?.ifBlank { null },
                            sessionId = sessionId?.trim()?.ifBlank { null },
                            sourceHint = sourceHint?.trim()?.ifBlank { null },
                        ),
                    )
                    isSaved = true
                    onSavedStateChanged(true)
                    Toast.makeText(context, savedText, Toast.LENGTH_SHORT).show()
                }
            },
        )

        if (expanded) {
            ArtifactContent(code = code, type = type)
        }
    }
}

private fun buildStableArtifactId(
    code: String,
    lang: String,
    type: ArtifactType,
    title: String,
): String {
    return listOf(type.name, lang, title, code)
        .joinToString(separator = "::yuanio::")
        .hashCode()
        .toUInt()
        .toString(16)
}

@Composable
private fun ArtifactHeader(
    lang: String,
    type: ArtifactType,
    isSaved: Boolean,
    onToggle: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onSave: () -> Unit,
) {
    val cdCopy = stringResource(R.string.cd_copy)
    val cdShare = stringResource(R.string.cd_share)
    val cdSave = stringResource(R.string.cd_save)
    val cdUnsave = stringResource(R.string.cd_unsave)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
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
                    fontSize = 11.sp,
                )
            },
        )
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onCopy, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_copy),
                contentDescription = cdCopy,
                modifier = Modifier.size(16.dp),
            )
        }
        IconButton(onClick = onShare, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_share),
                contentDescription = cdShare,
                modifier = Modifier.size(16.dp),
            )
        }
        IconButton(onClick = onSave, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(
                    if (isSaved) R.drawable.ic_tb_bookmark_filled else R.drawable.ic_tb_bookmark,
                ),
                contentDescription = if (isSaved) cdUnsave else cdSave,
                modifier = Modifier.size(16.dp),
                tint = if (isSaved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
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
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        ArtifactType.CODE -> Unit
    }
}

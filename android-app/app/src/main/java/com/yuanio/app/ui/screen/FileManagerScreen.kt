package com.yuanio.app.ui.screen

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R
import com.yuanio.app.data.UriFileUtils
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private enum class FileFilter {
    ALL,
    IMAGES,
    DOCUMENTS,
    MEDIA,
    ARCHIVES;

    fun matches(name: String): Boolean {
        val ext = extension(name)
        if (ext.isEmpty()) return this == ALL
        return when (this) {
            ALL -> true
            IMAGES -> ext in imageExt
            DOCUMENTS -> ext in documentExt
            MEDIA -> ext in mediaExt
            ARCHIVES -> ext in archiveExt
        }
    }

    companion object {
        private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic")
        private val documentExt = setOf("txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json", "yaml", "yml")
        private val mediaExt = setOf("mp3", "wav", "flac", "aac", "m4a", "mp4", "mkv", "mov", "avi")
        private val archiveExt = setOf("zip", "rar", "7z", "tar", "gz", "bz2")
    }
}

private val GeistBlue = Color(0xFF0070F3)
private val GeistBlueSoft = Color(0xFFEFF6FF)
private val GeistAmber = Color(0xFFF5A524)
private val GeistAmberSoft = Color(0xFFFFF5E8)
private val GeistPink = Color(0xFFD9437C)
private val GeistPinkSoft = Color(0xFFFFEDF4)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileManagerScreen(onBack: () -> Unit, onNavigateGit: () -> Unit = {}, vm: FileManagerViewModel = viewModel()) {
    val path by vm.path.collectAsStateWithLifecycle()
    val entries by vm.entries.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val fileContent by vm.fileContent.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val uploadState by vm.uploadState.collectAsStateWithLifecycle()
    val downloadedArtifact by vm.downloadedArtifact.collectAsStateWithLifecycle()
    val lastUploadedPath by vm.lastUploadedPath.collectAsStateWithLifecycle()
    val ocrState by vm.ocrState.collectAsStateWithLifecycle()
    val directoryBrowser by vm.directoryBrowser.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val downloadShareReadyTemplate = stringResource(R.string.file_manager_downloaded_share_ready)
    val ocrPromptTemplate = stringResource(R.string.file_manager_upload_ocr_prompt_template)

    var showNewDialog by remember { mutableStateOf(false) }
    var showRenameDialog by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf<String?>(null) }
    var showUploadActionsPath by remember { mutableStateOf<String?>(null) }
    var uploadCommitResult by remember { mutableStateOf<UploadCommitResult?>(null) }
    var uploadedLocalUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var latestOcrText by remember { mutableStateOf<String?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(FileFilter.ALL) }
    val uploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            uploadedLocalUri = uri
            latestOcrText = null
            vm.uploadUri(uri) { commit ->
                uploadCommitResult = commit
                val remotePath = commit?.path
                if (!remotePath.isNullOrBlank()) {
                    showUploadActionsPath = remotePath
                }
            }
        }
    }

    LaunchedEffect(Unit) { vm.connect() }
    LaunchedEffect(path) {
        vm.refreshDirectoryBrowser(path)
    }
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            vm.clearError()
        }
    }
    LaunchedEffect(lastUploadedPath) {
        val uploaded = lastUploadedPath ?: return@LaunchedEffect
        if (showUploadActionsPath == null) {
            showUploadActionsPath = uploaded
        }
    }
    LaunchedEffect(downloadedArtifact) {
        val artifact = downloadedArtifact ?: return@LaunchedEffect
        Toast.makeText(
            context,
            String.format(Locale.getDefault(), downloadShareReadyTemplate, artifact.fileName),
            Toast.LENGTH_SHORT
        ).show()
        vm.clearDownloadArtifact()
    }

    if (fileContent != null) {
        FileEditorView(
            path = path,
            initial = fileContent!!,
            onSave = { content ->
                vm.writeFile(path, content) { vm.closeFile() }
            },
            onClose = { vm.closeFile() }
        )
        return
    }

    val query = search.trim()
    val visibleEntries = remember(entries, query, filter) {
        entries.filter { entry ->
            val queryMatch = query.isEmpty() || entry.name.contains(query, ignoreCase = true)
            val filterMatch = entry.isDir || filter.matches(entry.name)
            queryMatch && filterMatch
        }
    }
    val folders = remember(visibleEntries) { visibleEntries.filter { it.isDir } }
    val files = remember(visibleEntries) { visibleEntries.filterNot { it.isDir } }
    val pinned = remember(folders) { folders.take(2) }
    val statusText = when {
        loading -> stringResource(R.string.file_manager_status_syncing)
        error != null -> stringResource(R.string.file_manager_status_connection_error)
        else -> stringResource(R.string.file_manager_status_connected_desktop)
    }
    val statusColor = when {
        loading -> GeistAmber
        error != null -> MaterialTheme.colorScheme.error
        else -> GeistBlue
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showNewDialog = true },
                shape = CircleShape,
                containerColor = MaterialTheme.colorScheme.onBackground,
                contentColor = MaterialTheme.colorScheme.background
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_tb_plus),
                    contentDescription = stringResource(R.string.file_manager_cd_new_item)
                )
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                FileHeaderCard(
                    path = path,
                    statusText = statusText,
                    statusColor = statusColor,
                    onBack = onBack,
                    onRefresh = { vm.ls(path) },
                    onNavigateGit = onNavigateGit,
                    onUpload = { uploadLauncher.launch(arrayOf("*/*")) },
                    onNavigateUp = if (path != ".") ({ vm.navigateUp() }) else null
                )
            }
            item {
                WorkspaceCwdCard(
                    browser = directoryBrowser,
                    browsingPath = path,
                    onRefresh = { vm.refreshDirectoryBrowser(path) },
                    onOpenDir = { vm.ls(it) },
                    onSetWorkingDir = { target ->
                        vm.changeCwd(target) { ok ->
                            if (ok) vm.refreshDirectoryBrowser(target)
                        }
                    },
                )
            }
            if (uploadState.active || uploadState.status.isNotBlank()) {
                item {
                    UploadProgressCard(uploadState)
                }
            }
            item {
                SearchField(search = search, onSearchChange = { search = it })
            }
            item {
                FilterRow(active = filter, onSelect = { filter = it })
            }
            item {
                StorageCard(path = path, folderCount = folders.size, fileCount = files.size)
            }

            if (loading && entries.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(220.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
            } else if (visibleEntries.isEmpty()) {
                item {
                    EmptyResultCard(query = query, filter = filter)
                }
            } else {
                if (pinned.isNotEmpty()) {
                    item { SectionHeader(stringResource(R.string.file_manager_section_pinned)) }
                    items(pinned, key = { "pinned-${it.name}" }) { entry ->
                        PinnedEntryCard(
                            entry = entry,
                            accentBlue = pinned.indexOf(entry) % 2 == 0,
                            onClick = { vm.ls(vm.resolvePath(entry.name)) },
                            onRename = { showRenameDialog = entry.name },
                            onDelete = { showDeleteConfirm = entry.name }
                        )
                    }
                }

                item {
                    SectionHeader(
                        title = stringResource(R.string.file_manager_section_folders),
                        trailing = {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (path != ".") {
                                    CompactIconButton(
                                        iconRes = R.drawable.ic_tb_chevron_up,
                                        contentDescription = stringResource(R.string.file_manager_cd_parent_dir),
                                        onClick = { vm.navigateUp() }
                                    )
                                }
                                CompactIconButton(
                                    iconRes = R.drawable.ic_tb_refresh,
                                    contentDescription = stringResource(R.string.file_manager_cd_refresh_dir),
                                    onClick = { vm.ls(path) }
                                )
                            }
                        }
                    )
                }

                if (folders.isEmpty()) {
                    item { EmptySectionCard(stringResource(R.string.file_manager_empty_no_dir_under_filter)) }
                } else {
                    items(folders, key = { "dir-${it.name}" }) { entry ->
                        FileListItem(
                            entry = entry,
                            onClick = { vm.ls(vm.resolvePath(entry.name)) },
                            onRename = { showRenameDialog = entry.name },
                            onDelete = { showDeleteConfirm = entry.name },
                            onDownload = null,
                            onShare = null
                        )
                    }
                }

                if (files.isNotEmpty()) {
                    item { SectionHeader(stringResource(R.string.file_manager_section_files)) }
                    items(files, key = { "file-${it.name}" }) { entry ->
                        val fullPath = vm.resolvePath(entry.name)
                        FileListItem(
                            entry = entry,
                            onClick = { vm.readFile(fullPath) },
                            onRename = { showRenameDialog = entry.name },
                            onDelete = { showDeleteConfirm = entry.name },
                            onDownload = { vm.downloadAndCache(fullPath) },
                            onShare = {
                                vm.downloadAndCache(fullPath) { artifact ->
                                    if (artifact != null) vm.shareDownloadedArtifact(artifact)
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    if (showNewDialog) {
        NewItemDialog(
            onDismiss = { showNewDialog = false },
            onCreate = { name, isDir ->
                showNewDialog = false
                val full = vm.resolvePath(name)
                if (isDir) vm.mkdir(full) { vm.ls(path) }
                else vm.writeFile(full, "") { vm.ls(path) }
            }
        )
    }

    showRenameDialog?.let { oldName ->
        RenameDialog(
            oldName = oldName,
            onDismiss = { showRenameDialog = null },
            onRename = { newName ->
                showRenameDialog = null
                vm.rename(vm.resolvePath(oldName), vm.resolvePath(newName)) { vm.ls(path) }
            }
        )
    }

    showDeleteConfirm?.let { name ->
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = null },
            title = { Text(stringResource(R.string.file_manager_delete_confirm_title)) },
            text = { Text(stringResource(R.string.file_manager_delete_confirm_message, name)) },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = null
                    vm.deleteFile(vm.resolvePath(name)) { vm.ls(path) }
                }) { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = null }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }

    val uploadedPath = showUploadActionsPath
    if (uploadedPath != null) {
        val localUri = uploadedLocalUri
        val commitResult = uploadCommitResult
        val promptRef = commitResult?.promptRef ?: "@$uploadedPath"
        val suggestedPrompt = commitResult?.suggestedPrompt ?: promptRef
        val mimeType = localUri?.let { context.contentResolver.getType(it) }
        val isImageUpload = localUri != null && UriFileUtils.isImageLike(mimeType, uploadedPath)
        ModalBottomSheet(onDismissRequest = {
            showUploadActionsPath = null
            uploadCommitResult = null
        }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = stringResource(R.string.file_manager_upload_done_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = uploadedPath,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Text(
                    text = stringResource(R.string.file_manager_upload_reference, promptRef),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                if (commitResult?.cleanupScheduledMs != null && commitResult.cleanupScheduledMs > 0) {
                    Text(
                        text = stringResource(
                            R.string.file_manager_upload_cleanup_in_seconds,
                            commitResult.cleanupScheduledMs / 1000
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                OutlinedButton(
                    onClick = { vm.sendCustomPrompt(suggestedPrompt) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.file_manager_upload_action_send_suggested_prompt))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { vm.sendCustomPrompt(promptRef) }) {
                        Text(stringResource(R.string.file_manager_upload_action_send_ref_only))
                    }
                    OutlinedButton(onClick = { vm.sendFileAction(uploadedPath, FileAgentAction.SUMMARIZE) }) {
                        Text(stringResource(R.string.file_manager_upload_action_summarize))
                    }
                    OutlinedButton(onClick = { vm.sendFileAction(uploadedPath, FileAgentAction.REVIEW) }) {
                        Text(stringResource(R.string.file_manager_upload_action_review))
                    }
                    OutlinedButton(onClick = { vm.sendFileAction(uploadedPath, FileAgentAction.TESTS) }) {
                        Text(stringResource(R.string.file_manager_upload_action_generate_tests))
                    }
                }
                if (isImageUpload) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                vm.runOcr(localUri) { text ->
                                    latestOcrText = text?.takeIf { it.isNotBlank() }
                                }
                            },
                            enabled = !ocrState.running
                        ) {
                            Text(
                                if (ocrState.running) {
                                    stringResource(R.string.file_manager_upload_ocr_processing)
                                } else {
                                    stringResource(R.string.file_manager_upload_ocr_extract_text)
                                }
                            )
                        }
                        if (!latestOcrText.isNullOrBlank()) {
                            OutlinedButton(
                                onClick = {
                                    vm.sendCustomPrompt(
                                        String.format(
                                            Locale.getDefault(),
                                            ocrPromptTemplate,
                                            uploadedPath,
                                            latestOcrText
                                        )
                                    )
                                }
                            ) {
                                Text(stringResource(R.string.file_manager_upload_action_send_ocr))
                            }
                        }
                    }
                    if (!latestOcrText.isNullOrBlank()) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
                        ) {
                            Text(
                                text = latestOcrText!!.take(280),
                                modifier = Modifier.padding(12.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun FileHeaderCard(
    path: String,
    statusText: String,
    statusColor: Color,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onNavigateGit: () -> Unit,
    onUpload: () -> Unit,
    onNavigateUp: (() -> Unit)?
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = colors.surface,
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.4f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CompactIconButton(
                    iconRes = R.drawable.ic_tb_arrow_left,
                    contentDescription = stringResource(R.string.common_back),
                    onClick = onBack
                )
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.file_manager_title),
                        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.onSurface
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Text(
                            text = statusText,
                            style = MaterialTheme.typography.labelMedium,
                            color = colors.outline
                        )
                    }
                }
                CompactIconButton(
                    iconRes = R.drawable.ic_tb_refresh,
                    contentDescription = stringResource(R.string.file_manager_cd_refresh_dir),
                    onClick = onRefresh
                )
                Spacer(Modifier.width(6.dp))
                CompactIconButton(
                    iconRes = R.drawable.ic_tb_plus,
                    contentDescription = stringResource(R.string.file_manager_cd_upload_file),
                    onClick = onUpload
                )
                Spacer(Modifier.width(6.dp))
                CompactIconButton(
                    iconRes = R.drawable.ic_tb_git_commit,
                    contentDescription = stringResource(R.string.file_manager_cd_git),
                    onClick = onNavigateGit
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Surface(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                    color = colors.surfaceVariant.copy(alpha = 0.45f),
                    border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.35f))
                ) {
                    Text(
                        text = displayPath(path),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (onNavigateUp != null) {
                    CompactIconButton(
                        iconRes = R.drawable.ic_tb_chevron_up,
                        contentDescription = stringResource(R.string.file_manager_cd_parent_dir),
                        onClick = onNavigateUp
                    )
                }
            }
        }
    }
}

@Composable
private fun SearchField(search: String, onSearchChange: (String) -> Unit) {
    val colors = MaterialTheme.colorScheme
    OutlinedTextField(
        value = search,
        onValueChange = onSearchChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text(stringResource(R.string.file_manager_search_placeholder)) },
        leadingIcon = {
            Icon(
                painter = painterResource(R.drawable.ic_tb_search),
                contentDescription = stringResource(R.string.chat_topbar_menu_search),
                tint = colors.onSurfaceVariant
            )
        },
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.surface,
            unfocusedContainerColor = colors.surface,
            focusedBorderColor = colors.onSurface.copy(alpha = 0.35f),
            unfocusedBorderColor = colors.outlineVariant.copy(alpha = 0.45f),
            focusedTextColor = colors.onSurface,
            unfocusedTextColor = colors.onSurface
        )
    )
}

@Composable
private fun FilterRow(active: FileFilter, onSelect: (FileFilter) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        FileFilter.values().forEach { item ->
            val selected = item == active
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (selected) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.surface,
                border = BorderStroke(
                    1.dp,
                    if (selected) MaterialTheme.colorScheme.onBackground
                    else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)
                ),
                modifier = Modifier.clickable { onSelect(item) }
            ) {
                Text(
                    text = fileFilterLabel(item),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (selected) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun fileFilterLabel(filter: FileFilter): String =
    when (filter) {
        FileFilter.ALL -> stringResource(R.string.file_manager_filter_all)
        FileFilter.IMAGES -> stringResource(R.string.file_manager_filter_images)
        FileFilter.DOCUMENTS -> stringResource(R.string.file_manager_filter_documents)
        FileFilter.MEDIA -> stringResource(R.string.file_manager_filter_media)
        FileFilter.ARCHIVES -> stringResource(R.string.file_manager_filter_archives)
    }

@Composable
private fun StorageCard(path: String, folderCount: Int, fileCount: Int) {
    val colors = MaterialTheme.colorScheme
    val total = (folderCount + fileCount).coerceAtLeast(1)
    val progress = (fileCount.toFloat() / total.toFloat()).coerceIn(0f, 1f)

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.4f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_tb_folder),
                        contentDescription = null,
                        tint = colors.onSurfaceVariant,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = displayPath(path),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.onSurfaceVariant
                    )
                }
                Text(
                    text = stringResource(R.string.file_manager_storage_summary, folderCount, fileCount),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.outline
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(colors.surfaceVariant.copy(alpha = 0.6f))
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(progress)
                        .clip(CircleShape)
                        .background(GeistBlue)
                )
            }
        }
    }
}

@Composable
private fun UploadProgressCard(uploadState: UploadState) {
    val total = uploadState.totalBytes?.takeIf { it > 0L }
    val progress = if (total == null) null else (uploadState.sentBytes.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = if (uploadState.fileName.isBlank()) {
                    stringResource(R.string.file_manager_upload_task)
                } else {
                    stringResource(R.string.file_manager_upload_file, uploadState.fileName)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (progress != null) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth()
                )
                Text(
                    text = "${formatBytes(uploadState.sentBytes)} / ${formatBytes(total)} · ${uploadState.status}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            } else {
                Text(
                    text = "${formatBytes(uploadState.sentBytes)} · ${uploadState.status}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}

@Composable
private fun WorkspaceCwdCard(
    browser: DirectoryBrowserState,
    browsingPath: String,
    onRefresh: () -> Unit,
    onOpenDir: (String) -> Unit,
    onSetWorkingDir: (String) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.file_manager_cwd_title),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = browser.cwd,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                CompactIconButton(
                    iconRes = R.drawable.ic_tb_refresh,
                    contentDescription = stringResource(R.string.file_manager_cd_refresh_browser),
                    onClick = onRefresh
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onSetWorkingDir(browsingPath) }) {
                    Text(stringResource(R.string.file_manager_cwd_action_set_to_current))
                }
                browser.parent?.let { parent ->
                    OutlinedButton(onClick = { onOpenDir(parent) }) {
                        Text(stringResource(R.string.file_manager_cwd_action_open_parent))
                    }
                }
            }

            browser.error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            if (browser.roots.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.file_manager_cwd_section_roots),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    browser.roots.forEach { root ->
                        OutlinedButton(onClick = { onOpenDir(root) }) {
                            Text(root)
                        }
                    }
                }
            }

            if (browser.entries.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.file_manager_cwd_section_quick_dirs),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    browser.entries.take(12).forEach { entry ->
                        OutlinedButton(onClick = { onOpenDir(entry.path) }) {
                            Text(entry.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.outline,
            fontWeight = FontWeight.SemiBold
        )
        trailing?.invoke()
    }
}

@Composable
private fun PinnedEntryCard(
    entry: FileEntry,
    accentBlue: Boolean,
    onClick: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit
) {
    val accent = if (accentBlue) GeistBlue else GeistAmber
    val soft = if (accentBlue) GeistBlueSoft else GeistAmberSoft
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        color = soft,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.22f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(accent.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_tb_folder),
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                EntryMetaRow(
                    entry = entry,
                    leftColor = MaterialTheme.colorScheme.outline,
                    rightColor = MaterialTheme.colorScheme.outline
                )
            }
            EntryMenu(onRename = onRename, onDelete = onDelete, onDownload = null, onShare = null)
        }
    }
}

@Composable
private fun FileListItem(
    entry: FileEntry,
    onClick: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onDownload: (() -> Unit)?,
    onShare: (() -> Unit)?,
) {
    val colors = MaterialTheme.colorScheme
    val imageLike = FileFilter.IMAGES.matches(entry.name)
    val iconBg = when {
        entry.isDir -> colors.surfaceVariant.copy(alpha = 0.5f)
        imageLike -> GeistPinkSoft
        else -> colors.surfaceVariant.copy(alpha = 0.65f)
    }
    val iconTint = when {
        entry.isDir -> GeistBlue
        imageLike -> GeistPink
        else -> colors.onSurfaceVariant
    }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.35f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(iconBg),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    painter = painterResource(
                        if (entry.isDir) R.drawable.ic_tb_folder else R.drawable.ic_tb_file_description
                    ),
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = colors.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                EntryMetaRow(entry = entry, leftColor = colors.outline, rightColor = colors.outline)
            }
            EntryMenu(
                onRename = onRename,
                onDelete = onDelete,
                onDownload = onDownload,
                onShare = onShare
            )
        }
    }
}

@Composable
private fun EntryMetaRow(entry: FileEntry, leftColor: Color, rightColor: Color) {
    val fileCountTemplate = stringResource(R.string.file_manager_entry_file_count)
    val directoryLabel = stringResource(R.string.file_manager_entry_directory)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = entryLeftMeta(entry, fileCountTemplate, directoryLabel),
            style = MaterialTheme.typography.labelSmall,
            color = leftColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = formatModifiedTime(entry.modifiedAtMs),
            style = MaterialTheme.typography.labelSmall,
            color = rightColor,
            maxLines = 1
        )
    }
}

@Composable
private fun EntryMenu(
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onDownload: (() -> Unit)?,
    onShare: (() -> Unit)?,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_dots_vertical),
                contentDescription = stringResource(R.string.common_more),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (onDownload != null) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.file_manager_action_download_phone)) },
                    onClick = { expanded = false; onDownload() }
                )
            }
            if (onShare != null) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.file_manager_action_download_and_share)) },
                    onClick = { expanded = false; onShare() }
                )
            }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.common_rename)) },
                onClick = { expanded = false; onRename() }
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.common_delete)) },
                onClick = { expanded = false; onDelete() }
            )
        }
    }
}

@Composable
private fun CompactIconButton(iconRes: Int, contentDescription: String, onClick: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f))
    ) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(34.dp)
        ) {
            Icon(
                painter = painterResource(iconRes),
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun EmptyResultCard(query: String, filter: FileFilter) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_tb_folder),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(28.dp)
            )
            Text(
                text = stringResource(R.string.file_manager_empty_no_match),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            val reason = if (query.isNotEmpty()) {
                stringResource(R.string.file_manager_empty_reason_keyword, query)
            } else {
                stringResource(R.string.file_manager_empty_reason_filter, fileFilterLabel(filter))
            }
            Text(
                text = reason,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
        }
    }
}

@Composable
private fun EmptySectionCard(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.outline
        )
    }
}

private fun extension(name: String): String {
    val idx = name.lastIndexOf(".")
    return if (idx <= 0 || idx == name.lastIndex) "" else name.substring(idx + 1).lowercase()
}

private fun displayPath(path: String): String = if (path == "." || path.isBlank()) "./" else path

private fun entryLeftMeta(entry: FileEntry, fileCountTemplate: String, directoryLabel: String): String {
    if (!entry.isDir) return formatBytes(entry.sizeBytes)
    val countText = entry.fileCount?.let {
        String.format(Locale.getDefault(), fileCountTemplate, it)
    } ?: directoryLabel
    val sizeText = formatBytes(entry.totalSizeBytes)
    val summaryText = if (entry.summaryPartial && sizeText != "--") "~$sizeText" else sizeText
    return "$countText | $summaryText"
}

private fun formatBytes(bytes: Long?): String {
    if (bytes == null || bytes < 0L) return "--"
    if (bytes == 0L) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var idx = 0
    while (value >= 1024.0 && idx < units.lastIndex) {
        value /= 1024.0
        idx++
    }
    val precision = when {
        idx == 0 || value >= 100 -> 0
        value >= 10 -> 1
        else -> 2
    }
    return String.format(Locale.US, "%.${precision}f %s", value, units[idx])
}

private fun formatModifiedTime(ms: Long?): String {
    if (ms == null || ms <= 0L) return "--"
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
        .withLocale(Locale.getDefault())
    return formatter.format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FileEditorView(path: String, initial: String, onSave: (String) -> Unit, onClose: () -> Unit) {
    var text by remember(initial) { mutableStateOf(initial) }
    val modified = text != initial

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(path.substringAfterLast("/"), maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_arrow_left),
                            contentDescription = stringResource(R.string.common_close)
                        )
                    }
                },
                actions = {
                    if (modified) {
                        TextButton(onClick = { onSave(text) }) { Text(stringResource(R.string.common_save)) }
                    }
                }
            )
        }
    ) { padding ->
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(8.dp),
            textStyle = androidx.compose.ui.text.TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp
            )
        )
    }
}

@Composable
private fun NewItemDialog(onDismiss: () -> Unit, onCreate: (String, Boolean) -> Unit) {
    var name by remember { mutableStateOf("") }
    var isDir by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.file_manager_dialog_new_title)) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.file_manager_dialog_name_label)) },
                    singleLine = true
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 8.dp)
                ) {
                    Checkbox(checked = isDir, onCheckedChange = { isDir = it })
                    Text(stringResource(R.string.file_manager_dialog_folder_checkbox))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { if (name.isNotBlank()) onCreate(name.trim(), isDir) },
                enabled = name.isNotBlank()
            ) { Text(stringResource(R.string.common_create)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
private fun RenameDialog(oldName: String, onDismiss: () -> Unit, onRename: (String) -> Unit) {
    var newName by remember { mutableStateOf(oldName) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.common_rename)) },
        text = {
            OutlinedTextField(
                value = newName,
                onValueChange = { newName = it },
                label = { Text(stringResource(R.string.file_manager_dialog_new_name_label)) },
                singleLine = true
            )
        },
        confirmButton = {
            TextButton(
                onClick = { if (newName.isNotBlank()) onRename(newName.trim()) },
                enabled = newName.isNotBlank() && newName != oldName
            ) { Text(stringResource(R.string.common_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) }
        }
    )
}

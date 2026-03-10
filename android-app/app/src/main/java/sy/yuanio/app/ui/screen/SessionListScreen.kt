package sy.yuanio.app.ui.screen

import android.app.Application
import android.text.format.DateFormat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import sy.yuanio.app.data.ChatHistory
import sy.yuanio.app.data.KeyStore
import sy.yuanio.app.data.ApiClient
import sy.yuanio.app.R
import sy.yuanio.app.ui.component.BrandChipRow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SessionListViewModel(app: Application) : AndroidViewModel(app) {
    private val history = ChatHistory(app)
    private val keyStore = KeyStore(app)

    enum class SessionSource { REMOTE, LOCAL_ONLY }
    data class UiSessionItem(
        val id: String,
        val preview: String,
        val updatedAt: Long,
        val isCurrent: Boolean,
        val source: SessionSource,
        val hasLocal: Boolean,
        val onlineAgent: Boolean,
        val onlineApp: Boolean,
        val onlineCount: Int,
        val title: String = "",
        val tags: List<String> = emptyList(),
    )

    private val _sessions = MutableStateFlow<List<UiSessionItem>>(emptyList())
    val sessions = _sessions.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    // 搜索与标签过滤
    private val _searchQuery = MutableStateFlow("")
    val searchQuery = _searchQuery.asStateFlow()

    private val _allTags = MutableStateFlow<Set<String>>(emptySet())
    val allTags = _allTags.asStateFlow()

    private val _selectedTag = MutableStateFlow<String?>(null)
    val selectedTag = _selectedTag.asStateFlow()

    fun setSearchQuery(q: String) { _searchQuery.value = q }
    fun selectTag(tag: String?) { _selectedTag.value = if (_selectedTag.value == tag) null else tag }

    fun updateTitle(id: String, title: String) {
        history.updateTitle(id, title); refresh()
    }
    fun updateTags(id: String, tags: List<String>) {
        history.updateTags(id, tags); refresh()
    }

    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            val localList = history.sessionList()
            val localMap = localList.associateBy { it.id }
            val currentId = keyStore.sessionId

            val remoteResult = try {
                val url = keyStore.serverUrl
                val token = keyStore.sessionToken
                if (url.isNullOrBlank() || token.isNullOrBlank()) null
                else ApiClient(url).fetchSessionList(token)
            } catch (_: Exception) {
                null
            }

            if (remoteResult == null) {
                _error.value = getApplication<Application>().getString(R.string.session_error_remote_fallback_local)
            } else {
                _error.value = null
            }

            val remoteSessions = remoteResult?.sessions ?: emptyList()
            val remoteMap = remoteSessions.associateBy { it.sessionId }
            val currentSessionId = remoteResult?.currentSessionId ?: currentId

            val merged = mutableListOf<UiSessionItem>()
            for (remote in remoteSessions) {
                val local = localMap[remote.sessionId]
                val updatedAt = if ((local?.updatedAt ?: 0L) > 0L) local!!.updatedAt else remote.lastSeen
                merged.add(
                    UiSessionItem(
                        id = remote.sessionId,
                        preview = local?.preview ?: "",
                        updatedAt = updatedAt,
                        isCurrent = remote.sessionId == currentSessionId,
                        source = SessionSource.REMOTE,
                        hasLocal = local != null,
                        onlineAgent = remote.hasAgentOnline,
                        onlineApp = remote.hasAppOnline,
                        onlineCount = remote.onlineCount,
                        title = local?.title ?: "",
                        tags = local?.tags ?: emptyList()
                    )
                )
            }

            for (local in localList) {
                if (remoteMap.containsKey(local.id)) continue
                merged.add(
                    UiSessionItem(
                        id = local.id,
                        preview = local.preview,
                        updatedAt = local.updatedAt,
                        isCurrent = local.id == currentSessionId,
                        source = SessionSource.LOCAL_ONLY,
                        hasLocal = true,
                        onlineAgent = false,
                        onlineApp = false,
                        onlineCount = 0,
                        title = local.title,
                        tags = local.tags
                    )
                )
            }

            _sessions.value = merged.sortedByDescending { it.updatedAt }
            _allTags.value = history.allTags()
        }
    }
    fun delete(id: String) { history.delete(id); refresh() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    onSelect: (String) -> Unit,
    onResume: ((String) -> Unit)? = null,
    vm: SessionListViewModel = viewModel()
) {
    LaunchedEffect(Unit) { vm.refresh() }
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val searchQuery by vm.searchQuery.collectAsStateWithLifecycle()
    val allTags by vm.allTags.collectAsStateWithLifecycle()
    val selectedTag by vm.selectedTag.collectAsStateWithLifecycle()
    var editTitleSession by remember { mutableStateOf<SessionListViewModel.UiSessionItem?>(null) }
    var editTagsSession by remember { mutableStateOf<SessionListViewModel.UiSessionItem?>(null) }

    // 过滤逻辑
    val displaySessions = remember(sessions, searchQuery, selectedTag) {
        var list = sessions
        if (searchQuery.isNotBlank()) {
            val q = searchQuery.lowercase()
            list = list.filter {
                it.title.lowercase().contains(q)
                        || it.preview.lowercase().contains(q)
                        || it.id.lowercase().contains(q)
                        || it.tags.any { t -> t.lowercase().contains(q) }
            }
        }
        if (selectedTag != null) {
            list = list.filter { selectedTag in it.tags }
        }
        list
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.session_title)) },
                actions = {
                    IconButton(onClick = { vm.refresh() }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_refresh),
                            contentDescription = stringResource(R.string.common_refresh)
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // 搜索栏
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { vm.setSearchQuery(it) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                placeholder = { Text(stringResource(R.string.session_search_placeholder)) },
                singleLine = true,
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { vm.setSearchQuery("") }) {
                            Icon(
                                painter = painterResource(R.drawable.ic_tb_x),
                                contentDescription = stringResource(R.string.common_clear)
                            )
                        }
                    }
                }
            )

            // 标签过滤行
            if (allTags.isNotEmpty()) {
                LazyRow(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(allTags.toList().sorted()) { tag ->
                        FilterChip(
                            selected = tag == selectedTag,
                            onClick = { vm.selectTag(tag) },
                            label = { Text(tag) }
                        )
                    }
                }
            }
            if (!error.isNullOrBlank()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_alert_triangle),
                            contentDescription = stringResource(R.string.notifier_error_title),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            error!!,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    stringResource(R.string.common_supported_models),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.outline
                )
                BrandChipRow()
            }
            if (displaySessions.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_message_circle),
                            contentDescription = stringResource(R.string.session_cd_empty),
                            tint = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.size(56.dp)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(stringResource(R.string.session_empty), color = MaterialTheme.colorScheme.outline)
                    }
                }
            } else {
                Text(
                    stringResource(R.string.session_count, displaySessions.size),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(displaySessions) { meta ->
                        SessionItem(
                            meta = meta,
                            onClick = { onSelect(meta.id) },
                            onResume = if (!meta.isCurrent && onResume != null) {{ onResume(meta.id) }} else null,
                            onDelete = { vm.delete(meta.id) },
                            onEditTitle = { editTitleSession = meta },
                            onEditTags = { editTagsSession = meta }
                        )
                    }
                }
            }
        }
    }

    // 编辑标题对话框
    editTitleSession?.let { session ->
        TitleEditorDialog(
            currentTitle = session.title.ifBlank { session.id.take(8) },
            onDismiss = { editTitleSession = null },
            onSave = { title ->
                vm.updateTitle(session.id, title)
                editTitleSession = null
            }
        )
    }

    // 编辑标签对话框
    editTagsSession?.let { session ->
        TagEditorDialog(
            currentTags = session.tags,
            onDismiss = { editTagsSession = null },
            onSave = { tags ->
                vm.updateTags(session.id, tags)
                editTagsSession = null
            }
        )
    }
}

@Composable
private fun SessionItem(
    meta: SessionListViewModel.UiSessionItem,
    onClick: () -> Unit,
    onResume: (() -> Unit)? = null,
    onDelete: () -> Unit,
    onEditTitle: () -> Unit = {},
    onEditTags: () -> Unit = {}
) {
    val onlinePrefix = stringResource(R.string.chat_input_status_online)
    val timeStr = if (meta.updatedAt > 0)
        DateFormat.format("MM/dd HH:mm", meta.updatedAt).toString() else stringResource(R.string.common_placeholder_dash)
    val preview = when {
        meta.preview.isNotBlank() -> meta.preview
        meta.source == SessionListViewModel.SessionSource.REMOTE -> stringResource(R.string.session_preview_remote_only)
        else -> stringResource(R.string.common_placeholder_dash)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    meta.title.ifBlank { meta.id.take(8) + "..." },
                    style = MaterialTheme.typography.bodyLarge
                )
                if (meta.isCurrent) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.session_current),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(Modifier.weight(1f))
                Text(
                    timeStr,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                if (onResume != null) {
                    IconButton(onClick = onResume) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_refresh),
                            contentDescription = stringResource(R.string.session_cd_resume),
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
                IconButton(onClick = onEditTitle) {
                    Icon(
                        painter = painterResource(R.drawable.ic_tb_edit),
                        contentDescription = stringResource(R.string.session_cd_edit_title),
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(18.dp)
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        painter = painterResource(R.drawable.ic_tb_trash),
                        contentDescription = stringResource(R.string.common_delete),
                        tint = MaterialTheme.colorScheme.outline
                    )
                }
            }

            if (meta.title.isNotBlank()) {
                Text(
                    meta.id.take(8),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }

            Spacer(Modifier.height(6.dp))
            Text(preview, maxLines = 2, overflow = TextOverflow.Ellipsis)

            val systemTags = buildList {
                add(
                    if (meta.source == SessionListViewModel.SessionSource.REMOTE) {
                        stringResource(R.string.session_tag_remote)
                    } else {
                        stringResource(R.string.session_tag_local)
                    }
                )
                if (meta.hasLocal && meta.source == SessionListViewModel.SessionSource.REMOTE) {
                    add(stringResource(R.string.session_tag_cached))
                }
                if (meta.onlineAgent || meta.onlineApp) {
                    add(buildString {
                        append(stringResource(R.string.chat_input_status_online))
                        if (meta.onlineCount > 0) append("·${meta.onlineCount}")
                    })
                }
            }
            val allChips = systemTags + meta.tags
            if (allChips.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(allChips.size) { idx ->
                        val tag = allChips[idx]
                        val isUserTag = idx >= systemTags.size
                        SuggestionChip(
                            onClick = {},
                            label = {
                                Text(
                                    tag,
                                    color = when {
                                        isUserTag -> MaterialTheme.colorScheme.secondary
                                        tag.startsWith(onlinePrefix) -> MaterialTheme.colorScheme.tertiary
                                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                            }
                        )
                    }
                    item {
                        SuggestionChip(
                            onClick = onEditTags,
                            label = { Text(stringResource(R.string.session_tag_add)) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TitleEditorDialog(
    currentTitle: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit
) {
    var title by remember { mutableStateOf(currentTitle) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.session_dialog_edit_title)) },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text(stringResource(R.string.session_dialog_title_label)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(title.trim()) },
                enabled = title.trim().isNotBlank()
            ) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
private fun TagEditorDialog(
    currentTags: List<String>,
    onDismiss: () -> Unit,
    onSave: (List<String>) -> Unit
) {
    val tags = remember(currentTags) { mutableStateListOf<String>().apply { addAll(currentTags) } }
    var newTag by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.session_dialog_manage_tags)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // 已有标签
                if (tags.isNotEmpty()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(tags.size) { idx ->
                            InputChip(
                                selected = false,
                                onClick = {
                                    tags.removeAt(idx)
                                },
                                label = { Text(tags[idx]) },
                                trailingIcon = {
                                    Icon(
                                        painter = painterResource(R.drawable.ic_tb_x),
                                        contentDescription = stringResource(R.string.common_remove),
                                        modifier = Modifier.size(14.dp)
                                    )
                                }
                            )
                        }
                    }
                }
                // 添加新标签
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = newTag,
                        onValueChange = { newTag = it },
                        label = { Text(stringResource(R.string.session_dialog_new_tag)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    TextButton(
                        onClick = {
                            val t = newTag.trim()
                            if (t.isNotBlank() && t !in tags) {
                                tags.add(t)
                                newTag = ""
                            }
                        },
                        enabled = newTag.trim().isNotBlank()
                    ) { Text(stringResource(R.string.common_add)) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(tags.toList()) }) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) }
        }
    )
}


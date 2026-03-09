package com.yuanio.app.ui.screen

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedAssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.TerminalPrefs
import com.yuanio.app.data.TerminalProfile
import com.yuanio.app.data.TerminalTabSnapshot
import com.yuanio.app.data.TerminalTabState
import com.yuanio.app.data.TerminalTheme
import com.yuanio.app.service.TerminalForegroundService
import com.yuanio.app.ui.terminal.SearchMatch
import com.yuanio.app.ui.terminal.ColorSchemeManager
import com.yuanio.app.ui.terminal.TerminalColorScheme
import com.yuanio.app.ui.terminal.TerminalEmulatorManager
import com.yuanio.app.ui.terminal.TerminalSearchHelper
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.connectbot.terminal.Terminal
import java.util.Locale
import java.util.UUID

data class TerminalTab(val id: String, val profileId: String, val title: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(vm: TerminalViewModel = viewModel()) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val clipboard = LocalClipboard.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val statusMap by vm.status.collectAsStateWithLifecycle()
    val metricsMap by vm.metrics.collectAsStateWithLifecycle()
    val relayState by vm.relayState.collectAsStateWithLifecycle()
    val relayError by vm.relayError.collectAsStateWithLifecycle()

    val tabs = remember { mutableStateListOf<TerminalTab>() }
    var activeId by remember { mutableStateOf<String?>(null) }
    val emulatorMap = remember { mutableStateMapOf<String, TerminalEmulatorManager>() }
    val searchMap = remember { mutableStateMapOf<String, TerminalSearchHelper>() }
    val sizeMap = remember { mutableStateMapOf<String, Pair<Int, Int>>() }

    var showMenu by remember { mutableStateOf(false) }
    var showTabManager by remember { mutableStateOf(false) }
    var showQuick by remember { mutableStateOf(false) }
    var renameTab by remember { mutableStateOf<TerminalTab?>(null) }
    var showSearch by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<SearchMatch>>(emptyList()) }
    var searchCursor by remember { mutableIntStateOf(-1) }
    var lastSearch by remember { mutableStateOf("") }

    var profiles by remember { mutableStateOf(TerminalPrefs.getProfiles()) }
    var activeProfileId by remember { mutableStateOf(TerminalPrefs.activeProfileId) }
    var maxTabs by remember { mutableIntStateOf(TerminalPrefs.maxTabs) }
    var fontSize by remember { mutableIntStateOf(TerminalPrefs.fontSize) }
    var theme by remember { mutableStateOf(TerminalPrefs.theme) }
    var quickCommands by remember { mutableStateOf(TerminalPrefs.getQuickCommands()) }
    var searchHistory by remember { mutableStateOf(TerminalPrefs.getSearchHistory()) }
    val defaultProfileName = stringResource(R.string.terminal_default_profile_name)
    val defaultShellLabel = stringResource(R.string.terminal_default_shell)
    val workingDirLabel = stringResource(R.string.terminal_working_dir)
    val maxTabsTemplate = stringResource(R.string.terminal_max_tabs)
    val terminalNoSelection = stringResource(R.string.terminal_no_selection)
    val commonCopied = stringResource(R.string.common_copied)
    val terminalSearchMatchTemplate = stringResource(R.string.terminal_search_match)
    val terminalClipboardEmpty = stringResource(R.string.terminal_clipboard_empty)
    val terminalMetricsTemplate = stringResource(R.string.terminal_metrics)
    val terminalPaused = stringResource(R.string.terminal_paused)
    val terminalStreaming = stringResource(R.string.terminal_streaming)
    val terminalSearchLocatedTemplate = stringResource(R.string.terminal_search_located)
    fun fmt(template: String, vararg args: Any): String = String.format(Locale.getDefault(), template, *args)

    fun fallback() = TerminalProfile(
        "__fallback__",
        defaultProfileName,
        "",
        "",
        13,
        2000,
        TerminalTheme.DARK
    )
    fun profile(id: String) = profiles.firstOrNull { it.id == id } ?: profiles.firstOrNull() ?: fallback()
    fun title(tab: TerminalTab): String {
        if (tab.title.isNotBlank()) return tab.title
        val p = profile(tab.profileId)
        return "${p.shell.ifBlank { defaultShellLabel }.substringAfterLast('/').substringAfterLast('\\')} · " +
            p.cwd.ifBlank { workingDirLabel }.substringAfterLast('/').substringAfterLast('\\')
    }
    fun scheme(p: TerminalProfile): TerminalColorScheme {
        // 优先使用 Profile 绑定的配色方案名称
        if (p.colorSchemeName.isNotBlank()) {
            return ColorSchemeManager.get(p.colorSchemeName)
        }
        return if (p.theme == TerminalTheme.DARK) TerminalColorScheme.DARK else TerminalColorScheme.LIGHT
    }
    fun scheme(t: TerminalTheme) = if (t == TerminalTheme.DARK) TerminalColorScheme.DARK else TerminalColorScheme.LIGHT
    fun persistTabs() {
        val snap = tabs.map { TerminalTabSnapshot(it.id, it.profileId, it.title) }
        TerminalPrefs.saveTabSnapshot(snap, activeId)
    }
    fun refreshPrefs() {
        profiles = TerminalPrefs.getProfiles()
        activeProfileId = TerminalPrefs.activeProfileId
        maxTabs = TerminalPrefs.maxTabs
        fontSize = TerminalPrefs.fontSize
        theme = TerminalPrefs.theme
        quickCommands = TerminalPrefs.getQuickCommands()
        searchHistory = TerminalPrefs.getSearchHistory()
    }
    fun makeManager(tabId: String, p: TerminalProfile, force: Boolean = false) {
        if (force) emulatorMap.remove(tabId)?.destroy()
        if (emulatorMap[tabId] != null) return
        val size = sizeMap[tabId] ?: (80 to 24)
        val mgr = TerminalEmulatorManager(
            ptyId = tabId,
            initialRows = size.second,
            initialCols = size.first,
            initialColorScheme = scheme(p.theme),
            onInput = { bytes -> vm.sendInput(tabId, bytes.toString(Charsets.UTF_8)) },
            onResize = { cols, rows ->
                sizeMap[tabId] = cols to rows
                vm.connect(tabId, cols, rows, p.shell.takeIf { it.isNotBlank() }, p.cwd.takeIf { it.isNotBlank() })
            },
        )
        mgr.collectInput(scope)
        emulatorMap[tabId] = mgr
        searchMap.putIfAbsent(tabId, TerminalSearchHelper())
        vm.connect(tabId, size.first, size.second, p.shell.takeIf { it.isNotBlank() }, p.cwd.takeIf { it.isNotBlank() })
    }
    fun addTab() {
        if (tabs.size >= maxTabs) {
            scope.launch { snackbar.showSnackbar(fmt(maxTabsTemplate, maxTabs)) }
            return
        }
        val id = UUID.randomUUID().toString()
        val tab = TerminalTab(id, activeProfileId, "")
        tabs.add(tab)
        sizeMap[id] = 80 to 24
        makeManager(id, profile(tab.profileId), force = true)
        activeId = id
        persistTabs()
    }
    fun restoreTabs() {
        val state: TerminalTabState = TerminalPrefs.getTabSnapshot()
        if (state.tabs.isEmpty()) {
            if (tabs.isEmpty()) addTab()
            return
        }
        tabs.clear()
        state.tabs.forEach { tabs.add(TerminalTab(it.id, it.profileId, it.title)) }
        activeId = state.activeId ?: state.tabs.first().id
        tabs.forEach {
            sizeMap.putIfAbsent(it.id, 80 to 24)
            makeManager(it.id, profile(it.profileId))
        }
    }
    fun closeTab(id: String) {
        vm.kill(id)
        emulatorMap.remove(id)?.destroy()
        searchMap.remove(id)
        sizeMap.remove(id)
        tabs.removeAll { it.id == id }
        if (tabs.isEmpty()) {
            addTab()
            return
        }
        if (activeId == id) activeId = tabs.first().id
        persistTabs()
    }
    fun applyProfile(profileId: String) {
        val active = activeId ?: return
        val p = profiles.firstOrNull { it.id == profileId } ?: return
        TerminalPrefs.setActiveProfile(p.id)
        val i = tabs.indexOfFirst { it.id == active }
        if (i >= 0) tabs[i] = tabs[i].copy(profileId = p.id)
        vm.kill(active)
        makeManager(active, p, force = true)
        refreshPrefs()
        persistTabs()
    }
    fun copySelection() {
        val active = activeId ?: return
        val text = emulatorMap[active]?.getSelectedTextOrNull()
        if (text.isNullOrBlank()) {
            scope.launch { snackbar.showSnackbar(terminalNoSelection) }
            return
        }
        clipboard.nativeClipboard.setPrimaryClip(ClipData.newPlainText("terminal-selection", text))
        scope.launch { snackbar.showSnackbar(commonCopied) }
    }
    fun updateSearch() {
        val q = searchQuery.trim()
        val active = activeId
        if (!showSearch || q.isBlank() || active == null) {
            searchResults = emptyList()
            searchCursor = -1
            return
        }
        searchResults = searchMap[active]?.search(q) ?: emptyList()
        searchCursor = if (searchResults.isEmpty()) -1 else 0
        if (q != lastSearch) {
            TerminalPrefs.addSearchHistory(q)
            searchHistory = TerminalPrefs.getSearchHistory()
            lastSearch = q
        }
    }
    fun moveSearch(step: Int) {
        if (searchResults.isEmpty()) return
        searchCursor = if (searchCursor < 0) 0 else (searchCursor + step).floorMod(searchResults.size)
        val hit = searchResults[searchCursor]
        scope.launch {
            snackbar.showSnackbar(
                fmt(
                    terminalSearchMatchTemplate,
                    searchCursor + 1,
                    searchResults.size,
                    hit.lineText.take(48)
                )
            )
        }
    }
    fun pasteText() {
        val active = activeId ?: return
        val clip = clipboard.nativeClipboard.primaryClip
        val txt = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString().orEmpty()
        if (txt.isBlank()) {
            scope.launch { snackbar.showSnackbar(terminalClipboardEmpty) }
            return
        }
        vm.sendInput(active, txt)
    }

    LaunchedEffect(Unit) { refreshPrefs(); restoreTabs() }
    LaunchedEffect(Unit) {
        vm.outputs.collect { out ->
            emulatorMap[out.ptyId]?.writeOutput(out.data)
            // 搜索索引在后台线程异步更新，避免阻塞 emulator 写入路径
            scope.launch(kotlinx.coroutines.Dispatchers.Default) {
                searchMap[out.ptyId]?.append(out.data)
            }
        }
    }
    LaunchedEffect(showSearch, searchQuery, activeId) { if (showSearch) { delay(180); updateSearch() } else { searchResults = emptyList(); searchCursor = -1; lastSearch = "" } }
    LaunchedEffect(theme, activeProfileId) { tabs.filter { it.profileId == activeProfileId }.forEach { emulatorMap[it.id]?.applyColorScheme(scheme(theme)) } }
    LaunchedEffect(relayError) { if (!relayError.isNullOrBlank()) scope.launch { snackbar.showSnackbar(relayError!!) } }
    LaunchedEffect(activeId) { if (activeId != null) persistTabs() }

    DisposableEffect(lifecycleOwner, relayState, activeId) {
        startTerminalService(ctx)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START && relayState == ConnectionState.DISCONNECTED && activeId != null) {
                vm.reconnect()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            stopTerminalService(ctx)
            emulatorMap.values.forEach { it.destroy() }
            emulatorMap.clear()
            searchMap.clear()
        }
    }

    val activeStatus = activeId?.let { statusMap[it] }
    val connected = activeStatus?.connected ?: false
    val exited = activeStatus?.exited ?: false
    val statusText = when {
        exited -> stringResource(R.string.terminal_status_exited)
        relayState == ConnectionState.DISCONNECTED -> stringResource(R.string.connection_disconnected)
        relayState == ConnectionState.RECONNECTING -> stringResource(R.string.terminal_status_reconnecting)
        connected -> stringResource(R.string.chat_input_status_online)
        else -> stringResource(R.string.terminal_status_connecting)
    }
    val activeMetrics = activeId?.let { metricsMap[it] }
    val metricsText = activeMetrics?.let {
        val kb = it.bufferedBytes / 1024f
        val buffered = if (kb >= 1f) String.format(Locale.getDefault(), "%.1fKB", kb) else "${it.bufferedBytes}B"
        fmt(
            terminalMetricsTemplate,
            it.cols,
            it.rows,
            buffered,
            if (it.paused) terminalPaused else terminalStreaming
        )
    }

    val relayText = when (relayState) {
        ConnectionState.CONNECTED -> stringResource(R.string.terminal_relay_connected)
        ConnectionState.RECONNECTING -> stringResource(R.string.connection_reconnecting)
        ConnectionState.DISCONNECTED -> stringResource(R.string.connection_disconnected)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.terminal_title))
                        Text(statusText, style = MaterialTheme.typography.labelSmall)
                        Text(
                            metricsText ?: relayText,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { showMenu = true }) {
                        Icon(
                            painterResource(R.drawable.ic_tb_dots_vertical),
                            contentDescription = stringResource(R.string.terminal_cd_more)
                        )
                    }
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_tab_manager)) },
                            onClick = { showMenu = false; showTabManager = true }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_quick_commands)) },
                            onClick = { showMenu = false; showQuick = true }
                        )
                        if (relayState != ConnectionState.CONNECTED) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.chat_action_reconnect)) },
                                onClick = { showMenu = false; vm.reconnect() }
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_copy_selection)) },
                            onClick = { showMenu = false; copySelection() }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_paste)) },
                            onClick = { showMenu = false; pasteText() }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_clear_screen)) },
                            onClick = { showMenu = false; activeId?.let { vm.sendInput(it, "\u001B[2J\u001B[H") } }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_reset)) },
                            onClick = { showMenu = false; activeId?.let { vm.sendInput(it, "\u001Bc") } }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_font_increase)) },
                            onClick = { showMenu = false; TerminalPrefs.fontSize = (fontSize + 1).coerceAtMost(22); refreshPrefs() }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.terminal_menu_font_decrease)) },
                            onClick = { showMenu = false; TerminalPrefs.fontSize = (fontSize - 1).coerceAtLeast(10); refreshPrefs() }
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    if (theme == TerminalTheme.DARK) {
                                        stringResource(R.string.terminal_menu_light_theme)
                                    } else {
                                        stringResource(R.string.terminal_menu_dark_theme)
                                    }
                                )
                            },
                            onClick = {
                                showMenu = false
                                TerminalPrefs.theme = if (theme == TerminalTheme.DARK) TerminalTheme.LIGHT else TerminalTheme.DARK
                                refreshPrefs()
                            }
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Tab 栏（拆分为独立组件）
            TerminalTabBar(
                tabs = tabs,
                activeId = activeId,
                onTabSelect = { activeId = it },
                onTabClose = { closeTab(it) },
                onAddTab = { addTab() },
                titleProvider = { title(it) },
                modifier = Modifier.fillMaxWidth(),
            )

            // Profile 快捷切换行
            LazyRow(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(profiles) { p -> AssistChip(onClick = { applyProfile(p.id) }, label = { Text(p.name) }) }
            }

            // 操作工具栏（拆分为独立组件）
            TerminalToolbar(
                onCopy = { copySelection() },
                onPaste = { pasteText() },
                onClear = { activeId?.let { vm.sendInput(it, "\u001B[2J\u001B[H") } },
                onToggleSearch = { showSearch = !showSearch },
                onQuickCommands = { showQuick = true },
                onTabManager = { showTabManager = true },
                onMore = { showMenu = true },
            )

            if (relayState != ConnectionState.CONNECTED || !relayError.isNullOrBlank()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = relayText,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        relayError?.takeIf { it.isNotBlank() }?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                        OutlinedButton(onClick = { vm.reconnect() }) {
                            Text(stringResource(R.string.chat_action_reconnect))
                        }
                    }
                }
            }

            if (showSearch) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (searchHistory.isNotEmpty()) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(searchHistory) { item -> AssistChip(onClick = { searchQuery = item }, label = { Text(item) }) }
                            item {
                                TextButton(onClick = { TerminalPrefs.clearSearchHistory(); searchHistory = emptyList() }) {
                                    Text(stringResource(R.string.terminal_search_clear_history))
                                }
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            placeholder = { Text(stringResource(R.string.terminal_search_placeholder)) }
                        )
                        Spacer(Modifier.width(8.dp))
                        IconButton(onClick = { moveSearch(-1) }) {
                            Icon(
                                painterResource(R.drawable.ic_tb_chevron_up),
                                contentDescription = stringResource(R.string.terminal_cd_previous)
                            )
                        }
                        IconButton(onClick = { moveSearch(1) }) {
                            Icon(
                                painterResource(R.drawable.ic_tb_chevron_down),
                                contentDescription = stringResource(R.string.terminal_cd_next)
                            )
                        }
                        IconButton(onClick = { searchQuery = ""; searchResults = emptyList(); searchCursor = -1 }) {
                            Icon(
                                painterResource(R.drawable.ic_tb_x),
                                contentDescription = stringResource(R.string.common_clear)
                            )
                        }
                    }
                    if (searchResults.isNotEmpty()) {
                        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 160.dp), contentPadding = PaddingValues(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            itemsIndexed(searchResults) { idx, match ->
                                Column(Modifier.fillMaxWidth().clickable {
                                    searchCursor = idx
                                    clipboard.nativeClipboard.setPrimaryClip(ClipData.newPlainText("terminal-search-line", match.lineText))
                                    scope.launch {
                                        snackbar.showSnackbar(
                                            fmt(terminalSearchLocatedTemplate, idx + 1)
                                        )
                                    }
                                }) {
                                    Text(
                                        stringResource(R.string.terminal_search_line, idx + 1, match.lineIndex + 1),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (idx == searchCursor) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                                    )
                                    Text(match.lineText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                            }
                        }
                    }
                }
            }

            val activeTab = activeId?.let { id -> tabs.firstOrNull { it.id == id } }
            val activeMgr = activeTab?.let { emulatorMap[it.id] }
            val activeScheme = scheme(activeTab?.let { profile(it.profileId).theme } ?: theme)
            Box(Modifier.fillMaxSize()) {
                if (activeMgr == null) {
                    Text(
                        stringResource(R.string.terminal_initializing),
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.outline
                    )
                } else {
                    Terminal(
                        terminalEmulator = activeMgr.emulator,
                        modifier = Modifier.fillMaxSize(),
                        typeface = Typeface.MONOSPACE,
                        initialFontSize = fontSize.sp,
                        minFontSize = 8.sp,
                        maxFontSize = 32.sp,
                        backgroundColor = activeScheme.background,
                        foregroundColor = activeScheme.foreground,
                        keyboardEnabled = connected,
                    )
                }
            }
        }
    }

    if (showTabManager) {
        ModalBottomSheet(onDismissRequest = { showTabManager = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.terminal_menu_tab_manager), style = MaterialTheme.typography.titleMedium)
                LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    itemsIndexed(tabs) { index, tab ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f).clickable { activeId = tab.id }) {
                                Text(title(tab), color = if (tab.id == activeId) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                                Text(profile(tab.profileId).name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                            TextButton(onClick = { renameTab = tab }) { Text(stringResource(R.string.terminal_action_rename)) }
                            TextButton(
                                onClick = { if (index > 0) { val item = tabs.removeAt(index); tabs.add(index - 1, item); persistTabs() } },
                                enabled = index > 0
                            ) { Text(stringResource(R.string.terminal_action_move_up)) }
                            TextButton(
                                onClick = { if (index < tabs.lastIndex) { val item = tabs.removeAt(index); tabs.add(index + 1, item); persistTabs() } },
                                enabled = index < tabs.lastIndex
                            ) { Text(stringResource(R.string.terminal_action_move_down)) }
                            TextButton(onClick = { if (tabs.size > 1) closeTab(tab.id) }, enabled = tabs.size > 1) {
                                Text(stringResource(R.string.common_close))
                            }
                        }
                    }
                }
                TextButton(onClick = { addTab() }) { Text(stringResource(R.string.terminal_action_add_tab)) }
            }
        }
    }

    if (showQuick) {
        ModalBottomSheet(onDismissRequest = { showQuick = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.terminal_menu_quick_commands), style = MaterialTheme.typography.titleMedium)
                LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(quickCommands, key = { it.id }) { cmd ->
                        Column(Modifier.fillMaxWidth()) {
                            Text(cmd.name)
                            Text(cmd.command, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            TextButton(onClick = {
                                val active = activeId ?: return@TextButton
                                vm.sendInput(active, if (cmd.appendNewline) "${cmd.command}\n" else cmd.command)
                            }) { Text(stringResource(R.string.chat_input_cd_send)) }
                        }
                    }
                }
            }
        }
    }

    renameTab?.let { tab ->
        var value by remember(tab.id) { mutableStateOf(tab.title) }
        AlertDialog(
            onDismissRequest = { renameTab = null },
            title = { Text(stringResource(R.string.terminal_rename_tab_title)) },
            text = {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text(stringResource(R.string.chat_dialog_template_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val i = tabs.indexOfFirst { it.id == tab.id }
                    if (i >= 0) tabs[i] = tabs[i].copy(title = value.trim())
                    persistTabs()
                    renameTab = null
                }) { Text(stringResource(R.string.common_save)) }
            },
            dismissButton = { TextButton(onClick = { renameTab = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

private fun Int.floorMod(other: Int): Int {
    if (other == 0) return this
    val r = this % other
    return if (r < 0) r + other else r
}

private fun startTerminalService(context: Context) {
    val intent = Intent(context, TerminalForegroundService::class.java).setAction(TerminalForegroundService.ACTION_START)
    context.startForegroundService(intent)
}

private fun stopTerminalService(context: Context) {
    val intent = Intent(context, TerminalForegroundService::class.java).setAction(TerminalForegroundService.ACTION_STOP)
    context.startService(intent)
}

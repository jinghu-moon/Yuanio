package com.yuanio.app.ui.screen

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R

private enum class SkillsTab {
    LIST,
    INSTALL,
    LOGS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkillsScreen(onBack: () -> Unit, vm: SkillsViewModel = viewModel()) {
    val skills by vm.skills.collectAsStateWithLifecycle()
    val candidates by vm.candidates.collectAsStateWithLifecycle()
    val selectedIds by vm.selectedCandidateIds.collectAsStateWithLifecycle()
    val installId by vm.installId.collectAsStateWithLifecycle()
    val summary by vm.summary.collectAsStateWithLifecycle()
    val logs by vm.logs.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var tab by remember { mutableStateOf(SkillsTab.LIST) }
    var scope by remember { mutableStateOf("project") }
    var source by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.connect() }
    LaunchedEffect(error) {
        if (!error.isNullOrBlank()) {
            Toast.makeText(context, error, Toast.LENGTH_SHORT).show()
            vm.clearError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.skills_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_arrow_left),
                            contentDescription = stringResource(R.string.common_back)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refreshSkills(scope) }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_tb_refresh),
                            contentDescription = stringResource(R.string.common_refresh)
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            PrimaryTabRow(selectedTabIndex = tab.ordinal) {
                SkillsTab.entries.forEach { item ->
                    Tab(
                        selected = tab == item,
                        onClick = { tab = item },
                        text = {
                            Text(
                                when (item) {
                                    SkillsTab.LIST -> stringResource(R.string.skills_tab_list)
                                    SkillsTab.INSTALL -> stringResource(R.string.skills_tab_install)
                                    SkillsTab.LOGS -> stringResource(R.string.skills_tab_logs)
                                }
                            )
                        }
                    )
                }
            }

            when (tab) {
                SkillsTab.LIST -> SkillsListTab(skills = skills, scope = scope, onScopeChanged = {
                    scope = it
                    vm.refreshSkills(it)
                })
                SkillsTab.INSTALL -> SkillsInstallTab(
                    source = source,
                    onSourceChanged = { source = it },
                    scope = scope,
                    onScopeChanged = { scope = it },
                    installId = installId,
                    candidates = candidates,
                    selectedIds = selectedIds,
                    summary = summary,
                    onPrepare = { vm.prepareInstall(source, scope) },
                    onCommitSkip = { vm.commitSelected("skip") },
                    onCommitOverwrite = { vm.commitSelected("overwrite") },
                    onLoadStatus = { vm.loadInstallStatus() },
                    onCancel = { vm.cancelInstall() },
                    onToggle = { id, checked -> vm.toggleCandidateSelection(id, checked) },
                    onSelectAll = { vm.selectAllValidCandidates() },
                    onClearSelected = { vm.clearSelectedCandidates() },
                )
                SkillsTab.LOGS -> SkillsLogsTab(logs = logs)
            }
        }

        if (loading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    }
}

@Composable
private fun SkillsListTab(
    skills: List<SkillItem>,
    scope: String,
    onScopeChanged: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        ScopeChips(scope = scope, onScopeChanged = onScopeChanged)
        if (skills.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.skills_empty_list), color = MaterialTheme.colorScheme.outline)
            }
            return
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(skills, key = { it.id.ifBlank { it.name } }) { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(item.name, style = MaterialTheme.typography.titleSmall)
                        Text(item.description, style = MaterialTheme.typography.bodySmall)
                        Text(
                            "${item.scope}/${item.source} · ${item.context} · invocable=${item.userInvocable}",
                            color = MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.labelSmall
                        )
                        Text(item.path, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun SkillsInstallTab(
    source: String,
    onSourceChanged: (String) -> Unit,
    scope: String,
    onScopeChanged: (String) -> Unit,
    installId: String?,
    candidates: List<SkillCandidate>,
    selectedIds: Set<String>,
    summary: SkillInstallSummary?,
    onPrepare: () -> Unit,
    onCommitSkip: () -> Unit,
    onCommitOverwrite: () -> Unit,
    onLoadStatus: () -> Unit,
    onCancel: () -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onSelectAll: () -> Unit,
    onClearSelected: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = source,
                onValueChange = onSourceChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.skills_label_source)) },
                placeholder = { Text(stringResource(R.string.skills_placeholder_source)) },
                singleLine = true,
            )
            ScopeChips(scope = scope, onScopeChanged = onScopeChanged)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onPrepare) { Text(stringResource(R.string.skills_button_prepare)) }
                Button(onClick = onLoadStatus) { Text(stringResource(R.string.skills_button_status)) }
                Button(onClick = onCancel) { Text(stringResource(R.string.skills_button_cancel)) }
            }
            Text(
                stringResource(
                    R.string.skills_install_id,
                    installId ?: stringResource(R.string.skills_install_id_none)
                ),
                color = MaterialTheme.colorScheme.outline
            )
            if (summary != null) {
                Text(
                    stringResource(
                        R.string.skills_result_summary,
                        summary.total,
                        summary.installed,
                        summary.skipped,
                        summary.failed
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelectAll) { Text(stringResource(R.string.skills_button_select_all)) }
                Button(onClick = onClearSelected) { Text(stringResource(R.string.skills_button_clear_selected)) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCommitSkip) { Text(stringResource(R.string.skills_button_commit_skip)) }
                Button(onClick = onCommitOverwrite) { Text(stringResource(R.string.skills_button_commit_overwrite)) }
            }
        }
        if (candidates.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.skills_empty_candidates), color = MaterialTheme.colorScheme.outline)
            }
            return
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(candidates, key = { it.id }) { candidate ->
                val checked = selectedIds.contains(candidate.id)
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Checkbox(
                            checked = checked,
                            onCheckedChange = { onToggle(candidate.id, it) },
                            enabled = candidate.valid,
                        )
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(
                                if (candidate.valid) {
                                    candidate.name
                                } else {
                                    stringResource(R.string.skills_candidate_invalid, candidate.name)
                                },
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(candidate.description, style = MaterialTheme.typography.bodySmall)
                            Text(candidate.path, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                            if (candidate.warnings.isNotEmpty()) {
                                Text(
                                    stringResource(
                                        R.string.skills_warnings,
                                        candidate.warnings.joinToString(",")
                                    ),
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SkillsLogsTab(logs: List<SkillsLogItem>) {
    if (logs.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.skills_empty_logs), color = MaterialTheme.colorScheme.outline)
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(logs, key = { "${it.at}_${it.message}" }) { item ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "${java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date(item.at))} [${item.level}]",
                        color = MaterialTheme.colorScheme.outline,
                        style = MaterialTheme.typography.labelSmall
                    )
                    Text(item.message, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun ScopeChips(scope: String, onScopeChanged: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 12.dp)) {
        FilterChip(
            selected = scope == "project",
            onClick = { onScopeChanged("project") },
            label = { Text(stringResource(R.string.scope_project)) }
        )
        FilterChip(
            selected = scope == "user",
            onClick = { onScopeChanged("user") },
            label = { Text(stringResource(R.string.scope_user)) }
        )
        FilterChip(
            selected = scope == "all",
            onClick = { onScopeChanged("all") },
            label = { Text(stringResource(R.string.scope_all)) }
        )
    }
}

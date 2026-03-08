package com.yuanio.app.ui.screen

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanio.app.R
import com.yuanio.app.ui.component.DiffView
import com.yuanio.app.ui.theme.LocalYuanioColors

private enum class GitTab {
    STATUS, LOG, BRANCH
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitScreen(onBack: () -> Unit, vm: GitViewModel = viewModel()) {
    val status by vm.status.collectAsStateWithLifecycle()
    val log by vm.log.collectAsStateWithLifecycle()
    val branchInfo by vm.branchInfo.collectAsStateWithLifecycle()
    val selectedDiff by vm.selectedDiff.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var selectedTab by remember { mutableStateOf(GitTab.STATUS) }

    LaunchedEffect(Unit) { vm.connect() }
    LaunchedEffect(error) {
        error?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show(); vm.clearError() }
    }

    // Diff 浮层
    if (selectedDiff != null) {
        val (file, diff) = selectedDiff!!
        DiffOverlay(file = file, diff = diff, onClose = { vm.closeDiff() })
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.git_title))
                        if (status.branch.isNotEmpty()) {
                            Text(
                                status.branch,
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(R.drawable.ic_ms_arrow_back),
                            contentDescription = stringResource(R.string.common_back)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = {
                        when (selectedTab) {
                            GitTab.STATUS -> vm.fetchStatus()
                            GitTab.LOG -> vm.fetchLog()
                            GitTab.BRANCH -> vm.fetchBranches()
                        }
                    }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_ms_refresh),
                            contentDescription = stringResource(R.string.common_refresh)
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            PrimaryTabRow(selectedTabIndex = selectedTab.ordinal) {
                GitTab.entries.forEach { tab ->
                    Tab(
                        selected = selectedTab == tab,
                        onClick = {
                            selectedTab = tab
                            when (tab) {
                                GitTab.STATUS -> vm.fetchStatus()
                                GitTab.LOG -> vm.fetchLog()
                                GitTab.BRANCH -> vm.fetchBranches()
                            }
                        },
                        text = {
                            Text(
                                when (tab) {
                                    GitTab.STATUS -> stringResource(R.string.git_tab_status)
                                    GitTab.LOG -> stringResource(R.string.git_tab_log)
                                    GitTab.BRANCH -> stringResource(R.string.git_tab_branch)
                                }
                            )
                        }
                    )
                }
            }

            Box(Modifier.fillMaxSize()) {
                when (selectedTab) {
                    GitTab.STATUS -> StatusTab(status, loading, onDiffClick = { vm.fetchDiff(it) })
                    GitTab.LOG -> LogTab(log, loading, onCommitDiff = { vm.fetchDiff(it) })
                    GitTab.BRANCH -> BranchTab(branchInfo, loading)
                }
                if (loading) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
            }
        }
    }
}

@Composable
private fun StatusTab(status: GitStatus, loading: Boolean, onDiffClick: (String) -> Unit) {
    val vibeCastColors = LocalYuanioColors.current
    val empty = status.staged.isEmpty() && status.modified.isEmpty() && status.untracked.isEmpty()
    if (empty && !loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.git_workspace_clean), color = MaterialTheme.colorScheme.outline)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (status.staged.isNotEmpty()) {
            item {
                FileGroupHeader(stringResource(R.string.git_group_staged), status.staged.size, vibeCastColors.success)
            }
            items(status.staged, key = { "s_$it" }) { file ->
                FileStatusRow(file, vibeCastColors.success, clickable = false, onClick = {})
            }
        }
        if (status.modified.isNotEmpty()) {
            item {
                FileGroupHeader(stringResource(R.string.git_group_modified), status.modified.size, vibeCastColors.warning)
            }
            items(status.modified, key = { "m_$it" }) { file ->
                FileStatusRow(file, vibeCastColors.warning, clickable = true, onClick = { onDiffClick(file) })
            }
        }
        if (status.untracked.isNotEmpty()) {
            item {
                FileGroupHeader(stringResource(R.string.git_group_untracked), status.untracked.size, MaterialTheme.colorScheme.outline)
            }
            items(status.untracked, key = { "u_$it" }) { file ->
                FileStatusRow(file, MaterialTheme.colorScheme.outline, clickable = false, onClick = {})
            }
        }
    }
}

@Composable
private fun FileGroupHeader(title: String, count: Int, color: Color) {
    Row(
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = color)
        Text("$count", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun FileStatusRow(file: String, color: Color, clickable: Boolean, onClick: () -> Unit) {
    val mod = if (clickable) Modifier.clickable { onClick() } else Modifier
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = mod.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_ms_description),
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                file,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun LogTab(commits: List<GitCommit>, loading: Boolean, onCommitDiff: (String) -> Unit) {
    if (commits.isEmpty() && !loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.git_empty_commits), color = MaterialTheme.colorScheme.outline)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(commits, key = { it.hash }) { commit ->
            CommitCard(commit)
        }
    }
}

@Composable
private fun CommitCard(commit: GitCommit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(
                commit.message,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    commit.author,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Text(
                    commit.hash.take(7),
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Text(
                commit.date,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
        }
    }
}

@Composable
private fun BranchTab(info: GitBranchInfo, loading: Boolean) {
    if (info.branches.isEmpty() && !loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.git_empty_branches), color = MaterialTheme.colorScheme.outline)
        }
        return
    }

    val local = info.branches.filter { !it.isRemote }
    val remote = info.branches.filter { it.isRemote }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (local.isNotEmpty()) {
            item {
                Text(
                    stringResource(R.string.git_section_local_branches),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(top = 4.dp, bottom = 4.dp)
                )
            }
            items(local, key = { "l_${it.name}" }) { branch ->
                BranchRow(branch, isCurrent = branch.name == info.current)
            }
        }
        if (remote.isNotEmpty()) {
            item {
                Text(
                    stringResource(R.string.git_section_remote_branches),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)
                )
            }
            items(remote, key = { "r_${it.name}" }) { branch ->
                BranchRow(branch, isCurrent = false)
            }
        }
    }
}

@Composable
private fun BranchRow(branch: GitBranch, isCurrent: Boolean) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (isCurrent) {
                Icon(
                    painter = painterResource(R.drawable.ic_ms_check_circle),
                    contentDescription = stringResource(R.string.git_cd_current_branch),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                branch.name,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                color = if (isCurrent) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiffOverlay(file: String, diff: String, onClose: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        file.substringAfterLast("/"),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(
                            painter = painterResource(R.drawable.ic_ms_arrow_back),
                            contentDescription = stringResource(R.string.common_close)
                        )
                    }
                }
            )
        }
    ) { padding ->
        if (diff.isBlank()) {
            Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(stringResource(R.string.git_diff_empty), color = MaterialTheme.colorScheme.outline)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(12.dp)
            ) {
                item {
                    DiffView(
                        path = file,
                        diff = diff,
                        action = "modified"
                    )
                }
            }
        }
    }
}

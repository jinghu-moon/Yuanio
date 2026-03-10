package sy.yuanio.app.ui.screen

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R

/**
 * 终端标签栏：可滚动的 Tab 行 + 新建 Tab 按钮。
 *
 * 从 TerminalScreen 拆出，使 TerminalScreen 专注于状态协调。
 */
@Composable
fun TerminalTabBar(
    tabs: List<TerminalTab>,
    activeId: String?,
    onTabSelect: (String) -> Unit,
    onTabClose: (String) -> Unit,
    onAddTab: () -> Unit,
    titleProvider: (TerminalTab) -> String,
    modifier: Modifier = Modifier,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (tabs.isEmpty()) {
            Text(
                stringResource(R.string.terminal_initializing),
                modifier = Modifier
                    .weight(1f)
                    .then(Modifier),
                color = androidx.compose.material3.MaterialTheme.colorScheme.outline
            )
        } else {
            val selected = tabs.indexOfFirst { it.id == activeId }.coerceAtLeast(0)
            PrimaryScrollableTabRow(
                selectedTabIndex = selected,
                modifier = Modifier.weight(1f),
                edgePadding = 8.dp,
            ) {
                tabs.forEachIndexed { i, tab ->
                    Tab(
                        selected = i == selected,
                        onClick = { onTabSelect(tab.id) },
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                // 如果 Profile 有 icon，显示在标题前
                                Text(titleProvider(tab))
                                if (tabs.size > 1) {
                                    Spacer(Modifier.width(6.dp))
                                    IconButton(
                                        onClick = { onTabClose(tab.id) },
                                        modifier = Modifier.size(18.dp),
                                    ) {
                                        Icon(
                                            painterResource(R.drawable.ic_tb_x),
                                            contentDescription = stringResource(R.string.common_close),
                                        )
                                    }
                                }
                            }
                        },
                    )
                }
            }
        }
        IconButton(onClick = onAddTab) {
            Icon(
                painterResource(R.drawable.ic_tb_plus),
                contentDescription = stringResource(R.string.terminal_cd_new_terminal),
            )
        }
    }
}


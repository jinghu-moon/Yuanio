package sy.yuanio.app.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ElevatedAssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R

/**
 * 终端快捷操作工具栏：水平 Chip 行，提供复制/粘贴/清屏/搜索/快捷命令/Tab管理等。
 *
 * 从 TerminalScreen 拆出，使操作入口独立可复用。
 */
@Composable
fun TerminalToolbar(
    onCopy: () -> Unit,
    onPaste: () -> Unit,
    onClear: () -> Unit,
    onToggleSearch: () -> Unit,
    onQuickCommands: () -> Unit,
    onTabManager: () -> Unit,
    onMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // 快捷操作按钮定义
    val buttons = listOf(
        ToolbarAction("copy", R.string.terminal_menu_copy_selection, R.drawable.ic_tb_file_description, onCopy),
        ToolbarAction("paste", R.string.terminal_menu_paste, R.drawable.ic_tb_file_description, onPaste),
        ToolbarAction("clear", R.string.terminal_menu_clear_screen, R.drawable.ic_tb_refresh, onClear),
        ToolbarAction("search", R.string.chat_topbar_menu_search, R.drawable.ic_tb_search, onToggleSearch),
        ToolbarAction("command", R.string.terminal_menu_quick_commands, R.drawable.ic_tb_bolt, onQuickCommands),
        ToolbarAction("tabs", R.string.terminal_menu_tab_manager, R.drawable.ic_tb_list_details, onTabManager),
        ToolbarAction("more", R.string.terminal_cd_more, R.drawable.ic_tb_dots_vertical, onMore),
    )

    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(buttons, key = { it.key }) { action ->
            val label = stringResource(action.labelRes)
            ElevatedAssistChip(
                onClick = action.onClick,
                label = { Text(label) },
                leadingIcon = {
                    Icon(
                        painterResource(action.iconRes),
                        contentDescription = label,
                        modifier = Modifier.size(16.dp),
                    )
                },
            )
        }
    }
}

/** 工具栏操作项 */
private data class ToolbarAction(
    val key: String,
    val labelRes: Int,
    val iconRes: Int,
    val onClick: () -> Unit,
)


package com.yuanio.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yuanio.app.R

/**
 * 终端命令面板（Command Palette）
 *
 * 类似 Windows Terminal 的 Ctrl+Shift+P 功能，以 BottomSheet 形式呈现。
 * 提供搜索框 + 可模糊搜索的操作列表。
 */

/** 单个命令面板操作项 */
data class PaletteCommand(
    val id: String,
    val label: String,
    val description: String = "",
    val icon: Int? = null,
    val shortcut: String? = null,
    val action: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandPalette(
    commands: List<PaletteCommand>,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    // 模糊搜索：按 label 和 description 过滤
    val filtered = remember(query, commands) {
        if (query.isBlank()) {
            commands
        } else {
            val q = query.lowercase().trim()
            commands.filter { cmd ->
                cmd.label.lowercase().contains(q) ||
                    cmd.description.lowercase().contains(q) ||
                    cmd.id.lowercase().contains(q)
            }
        }
    }

    // 自动聚焦搜索框
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
        ) {
            // 标题
            Text(
                stringResource(R.string.terminal_command_palette_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 12.dp),
            )

            // 搜索框
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                singleLine = true,
                placeholder = {
                    Text(
                        stringResource(R.string.terminal_command_palette_search),
                        color = MaterialTheme.colorScheme.outline,
                    )
                },
                leadingIcon = {
                    Icon(
                        painterResource(R.drawable.ic_tb_search),
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                },
            )

            Spacer(Modifier.height(8.dp))

            // 结果列表
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(filtered, key = { it.id }) { cmd ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                cmd.action()
                                onDismiss()
                            }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // 图标
                        if (cmd.icon != null) {
                            Icon(
                                painterResource(cmd.icon),
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.width(12.dp))
                        }

                        // 标签 + 描述
                        Column(Modifier.weight(1f)) {
                            Text(
                                cmd.label,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            if (cmd.description.isNotBlank()) {
                                Text(
                                    cmd.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            }
                        }

                        // 快捷键提示
                        if (cmd.shortcut != null) {
                            Text(
                                cmd.shortcut,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 10.sp,
                                ),
                                color = MaterialTheme.colorScheme.outline,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }

                // 无结果提示
                if (filtered.isEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.terminal_command_palette_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 24.dp, horizontal = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

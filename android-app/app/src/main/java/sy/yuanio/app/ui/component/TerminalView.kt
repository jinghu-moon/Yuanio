package sy.yuanio.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce

/**
 * 高性能终端文本渲染组件。
 *
 * 性能优化要点：
 * 1. 使用 itemsIndexed + index 做 key（避免无 key 的全量 diff）
 * 2. 共享一个 horizontal ScrollState（避免每行创建独立 ScrollState）
 * 3. 使用 scrollToItem 无动画滚动（避免高速输出时的动画堆积）
 * 4. 智能自动滚动检测（用户手动滚动时暂停自动滚底）
 */
@OptIn(FlowPreview::class)
@Composable
fun TerminalView(lines: List<String>, modifier: Modifier = Modifier) {
    if (lines.isEmpty()) return

    val listState = rememberLazyListState()
    // 共享一个 ScrollState（全部行共用水平滚动位置）
    val horizontalScrollState = rememberScrollState()

    // 追踪上次已知的行数，用于判断用户是否手动滚动
    var lastKnownSize by remember { mutableIntStateOf(lines.size) }

    // 判断用户是否在底部附近（±3行）
    val isAtBottom by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            last != null && last.index >= lines.size - 3
        }
    }

    // 只在列表增长且用户在底部时自动滚动（防抖 50ms，避免高频触发）
    LaunchedEffect(Unit) {
        snapshotFlow { lines.size }
            .debounce(50)
            .collect { newSize ->
                if (newSize > lastKnownSize && isAtBottom && newSize > 0) {
                    listState.scrollToItem(newSize - 1) // 无动画，性能更好
                }
                lastKnownSize = newSize
            }
    }

    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = 200.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(8.dp)
    ) {
        items(
            count = lines.size,
            key = { it }, // 用 index 做 key，保证稳定 diff
        ) { index ->
            Text(
                text = lines[index],
                color = MaterialTheme.colorScheme.onSurface,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 14.sp,
                modifier = Modifier.horizontalScroll(horizontalScrollState)
            )
        }
    }
}


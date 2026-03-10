package sy.yuanio.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import sy.yuanio.app.R
import sy.yuanio.app.data.TodoItem

@Composable
private fun TodoItemRow(todo: TodoItem) {
    val isCompleted = todo.status == "completed"
    val isInProgress = todo.status == "in_progress"

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 状态图标
        val (icon, tint) = when {
            isCompleted -> R.drawable.ic_tb_circle_check to MaterialTheme.colorScheme.primary
            isInProgress -> R.drawable.ic_tb_refresh to MaterialTheme.colorScheme.tertiary
            else -> R.drawable.ic_tb_hourglass_empty to MaterialTheme.colorScheme.outline
        }
        Icon(
            painter = painterResource(icon),
            contentDescription = todo.status,
            modifier = Modifier.size(16.dp),
            tint = tint
        )
        Spacer(Modifier.width(8.dp))

        // 内容
        Text(
            todo.content,
            style = MaterialTheme.typography.bodySmall,
            textDecoration = if (isCompleted) TextDecoration.LineThrough else TextDecoration.None,
            color = if (isCompleted) MaterialTheme.colorScheme.outline
                    else MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )

        // 优先级标签
        if (todo.priority == "high") {
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(R.string.todo_priority_high),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error
            )
        }
    }
}

@Composable
fun TodoCard(
    todos: List<TodoItem>,
    taskId: String? = null,
    agent: String? = null,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            // 标题行
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.ic_tb_list_details),
                    contentDescription = stringResource(R.string.cd_todo),
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.secondary
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    stringResource(R.string.todo_title),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary
                )
                if (!taskId.isNullOrBlank()) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.todo_task, taskId),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // 待办项列表
            todos.forEach { todo ->
                TodoItemRow(todo)
                Spacer(Modifier.height(4.dp))
            }

            // 统计摘要
            val completed = todos.count { it.status == "completed" }
            val total = todos.size
            if (total > 0) {
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { completed.toFloat() / total },
                    modifier = Modifier.fillMaxWidth().height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.todo_progress, completed, total),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}


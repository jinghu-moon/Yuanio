package sy.yuanio.app.ui.component

import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

class MessageContextMenuAction(
    val label: String,
    val enabled: Boolean = true,
    val onClick: () -> Unit,
)

@Composable
fun MessageContextMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    actions: List<MessageContextMenuAction>,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest) {
        actions.filter { it.enabled }.forEach { action ->
            DropdownMenuItem(
                text = { Text(action.label) },
                onClick = {
                    action.onClick()
                    onDismissRequest()
                }
            )
        }
    }
}


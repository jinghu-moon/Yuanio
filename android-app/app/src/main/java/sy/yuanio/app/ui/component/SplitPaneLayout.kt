package sy.yuanio.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme

@Composable
fun SplitPaneLayout(
    modifier: Modifier = Modifier,
    secondaryWeight: Float = 0.36f,
    primary: @Composable () -> Unit,
    secondary: @Composable () -> Unit,
) {
    Row(modifier = modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .weight(1f - secondaryWeight)
                .fillMaxHeight()
                .padding(end = 6.dp)
        ) {
            primary()
        }
        Box(
            modifier = Modifier
                .padding(vertical = 8.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                .padding(horizontal = 0.5.dp)
        )
        Box(
            modifier = Modifier
                .weight(secondaryWeight)
                .fillMaxHeight()
                .padding(start = 6.dp)
        ) {
            secondary()
        }
    }
}


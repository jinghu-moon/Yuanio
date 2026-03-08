package com.yuanio.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ElevatedFilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yuanio.app.R
import com.yuanio.app.data.Template

@Composable
fun TemplateChipRow(
    templates: List<Template>,
    onTemplateClick: (Template) -> Unit,
    onAddTemplateClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(templates, key = { it.id }) { template ->
            ElevatedFilterChip(
                selected = false,
                onClick = { onTemplateClick(template) },
                label = { Text(template.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            )
        }
        item {
            ElevatedFilterChip(
                selected = false,
                onClick = onAddTemplateClick,
                label = {
                    Icon(
                        painter = painterResource(R.drawable.ic_ms_add),
                        contentDescription = stringResource(R.string.cd_add_template)
                    )
                }
            )
        }
    }
}

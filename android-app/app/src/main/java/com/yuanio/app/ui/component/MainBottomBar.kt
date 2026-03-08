package com.yuanio.app.ui.component

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.yuanio.app.R

enum class MainTab(
    @param:StringRes @field:StringRes val labelRes: Int,
    val glyph: ActionGlyph,
    @param:StringRes @field:StringRes val contentDescRes: Int,
) {
    CHAT(R.string.main_tab_chat, ActionGlyph.CHAT, R.string.main_tab_chat_cd),
    TERMINAL(R.string.main_tab_terminal, ActionGlyph.TERMINAL, R.string.main_tab_terminal_cd),
    FILES(R.string.main_tab_files, ActionGlyph.FILES, R.string.main_tab_files_cd),
    SKILLS(R.string.main_tab_skills, ActionGlyph.SKILLS, R.string.main_tab_skills_cd),
    SETTINGS(R.string.main_tab_settings, ActionGlyph.SETTINGS, R.string.main_tab_settings_cd),
}

@Composable
fun MainBottomBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
) {
    NavigationBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
        MainTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = selected == tab,
                onClick = { onSelect(tab) },
                icon = {
                    ActionGlyphIcon(
                        glyph = tab.glyph,
                        contentDescription = stringResource(tab.contentDescRes),
                    )
                },
                label = { Text(stringResource(tab.labelRes)) },
                alwaysShowLabel = true,
            )
        }
    }
}

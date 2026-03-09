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
    HOME(R.string.main_tab_home, ActionGlyph.HOME, R.string.main_tab_home_cd),
    SESSIONS(R.string.main_tab_sessions, ActionGlyph.CHAT, R.string.main_tab_sessions_cd),
    TERMINAL(R.string.main_tab_terminal, ActionGlyph.TERMINAL, R.string.main_tab_terminal_cd),
    ENVIRONMENT(R.string.main_tab_environment, ActionGlyph.ENVIRONMENT, R.string.main_tab_environment_cd),
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

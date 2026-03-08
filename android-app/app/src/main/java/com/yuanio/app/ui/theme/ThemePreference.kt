package com.yuanio.app.ui.theme

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** 主题模式：跟随系统 / 浅色 / 深色 */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

object ThemePreference {
    private const val PREF_MODE_LEGACY_INT = "mode"
    private const val PREF_MODE_NAME = "mode_name"

    private lateinit var prefs: SharedPreferences
    private val _mode = MutableStateFlow(ThemeMode.SYSTEM)
    val mode = _mode.asStateFlow()

    fun init(context: Context) {
        prefs = context.getSharedPreferences("yuanio_theme", Context.MODE_PRIVATE)
        val resolved = resolvePersistedMode()
        _mode.value = resolved
        persistMode(resolved)
    }

    fun set(mode: ThemeMode) {
        _mode.value = mode
        persistMode(mode)
    }

    private fun resolvePersistedMode(): ThemeMode {
        if (prefs.contains(PREF_MODE_LEGACY_INT)) {
            // 历史版本长期使用 int 存储，这里优先按 int 读，确保升级后可自愈纠偏。
            return when (prefs.getInt(PREF_MODE_LEGACY_INT, 0)) {
                0 -> ThemeMode.SYSTEM
                1 -> ThemeMode.LIGHT
                2 -> ThemeMode.DARK
                else -> ThemeMode.SYSTEM
            }
        }

        val modeName = prefs.getString(PREF_MODE_NAME, null)
        if (!modeName.isNullOrBlank()) {
            return ThemeMode.entries.firstOrNull { it.name == modeName } ?: ThemeMode.SYSTEM
        }

        return ThemeMode.SYSTEM
    }

    private fun persistMode(mode: ThemeMode) {
        val legacyOrdinal = when (mode) {
            ThemeMode.SYSTEM -> 0
            ThemeMode.LIGHT -> 1
            ThemeMode.DARK -> 2
        }
        prefs.edit()
            .putString(PREF_MODE_NAME, mode.name)
            .putInt(PREF_MODE_LEGACY_INT, legacyOrdinal)
            .apply()
    }
}

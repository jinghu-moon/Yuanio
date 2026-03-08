package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences

enum class ComposerStyle {
    CLAUDE,
    CHATGPT,
    GEMINI,
}

object ComposerStylePrefs {
    private const val KEY_STYLE = "style"
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("yuanio_composer_style", Context.MODE_PRIVATE)
    }

    var style: ComposerStyle
        get() {
            val raw = prefs.getString(KEY_STYLE, ComposerStyle.CLAUDE.name)
            return ComposerStyle.entries.firstOrNull { it.name == raw } ?: ComposerStyle.CLAUDE
        }
        set(value) {
            prefs.edit().putString(KEY_STYLE, value.name).apply()
        }
}

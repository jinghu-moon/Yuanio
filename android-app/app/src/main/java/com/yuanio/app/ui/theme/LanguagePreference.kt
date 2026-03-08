package com.yuanio.app.ui.theme

import android.content.Context
import android.content.SharedPreferences
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AppLanguage(val tag: String) {
    SYSTEM(""),
    ZH_CN("zh-CN"),
    EN("en"),
}

object LanguagePreference {
    private const val PREF_NAME = "yuanio_language"
    private const val KEY_LANGUAGE_TAG = "language_tag"

    private lateinit var prefs: SharedPreferences

    private val _language = MutableStateFlow(AppLanguage.SYSTEM)
    val language = _language.asStateFlow()

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        _language.value = AppLanguage.entries.firstOrNull {
            it.tag == prefs.getString(KEY_LANGUAGE_TAG, AppLanguage.SYSTEM.tag)
        } ?: AppLanguage.SYSTEM
        applyLanguage(_language.value)
    }

    fun set(language: AppLanguage) {
        _language.value = language
        prefs.edit().putString(KEY_LANGUAGE_TAG, language.tag).apply()
        applyLanguage(language)
    }

    private fun applyLanguage(language: AppLanguage) {
        val locales = if (language == AppLanguage.SYSTEM) {
            LocaleListCompat.getEmptyLocaleList()
        } else {
            LocaleListCompat.forLanguageTags(language.tag)
        }
        AppCompatDelegate.setApplicationLocales(locales)
    }
}

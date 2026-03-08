package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences

object TtsPrefs {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("yuanio_tts", Context.MODE_PRIVATE)
    }

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(v) = prefs.edit().putBoolean("enabled", v).apply()

    var autoRead: Boolean
        get() = prefs.getBoolean("autoRead", false)
        set(v) = prefs.edit().putBoolean("autoRead", v).apply()

    var speechRate: Float
        get() = prefs.getFloat("speechRate", 1.0f)
        set(v) = prefs.edit().putFloat("speechRate", v).apply()

    var pitch: Float
        get() = prefs.getFloat("pitch", 1.0f)
        set(v) = prefs.edit().putFloat("pitch", v).apply()

    var language: String
        get() = prefs.getString("language", "zh-CN") ?: "zh-CN"
        set(v) = prefs.edit().putString("language", v).apply()
}

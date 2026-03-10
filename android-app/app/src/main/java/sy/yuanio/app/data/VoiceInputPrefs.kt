package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences

object VoiceInputPrefs {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("yuanio_voice_input", Context.MODE_PRIVATE)
    }

    var languageTag: String
        get() = prefs.getString("languageTag", "auto") ?: "auto"
        set(v) = prefs.edit().putString("languageTag", v).apply()

    var autoSubmitDraft: Boolean
        get() = prefs.getBoolean("autoSubmitDraft", false)
        set(v) = prefs.edit().putBoolean("autoSubmitDraft", v).apply()
}


package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.StringRes
import com.yuanio.app.R

enum class ConnectionMode(val value: String, @param:StringRes @field:StringRes val labelRes: Int) {
    AUTO("auto", R.string.connection_mode_auto_label),
    RELAY("relay", R.string.connection_mode_relay_label),
    LOCAL("local", R.string.connection_mode_local_label);

    companion object {
        fun fromValue(v: String) = entries.firstOrNull { it.value == v } ?: AUTO
    }
}

object LocalConnectionPrefs {
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("local_conn", Context.MODE_PRIVATE)
    }

    var mode: ConnectionMode
        get() = ConnectionMode.fromValue(prefs.getString("mode", "auto") ?: "auto")
        set(v) = prefs.edit().putString("mode", v.value).apply()

    var manualIp: String
        get() = prefs.getString("manual_ip", "") ?: ""
        set(v) = prefs.edit().putString("manual_ip", v).apply()

    var manualPort: Int
        get() = prefs.getInt("manual_port", 9394)
        set(v) = prefs.edit().putInt("manual_port", v).apply()
}

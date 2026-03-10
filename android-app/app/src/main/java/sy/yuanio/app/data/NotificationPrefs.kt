package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import sy.yuanio.app.YuanioApp

object NotificationPrefs {
    private const val PREFS_NAME = "yuanio_notification_prefs"
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun isChannelEnabled(channel: String): Boolean =
        prefs.getBoolean("channel_$channel", true)

    fun setChannelEnabled(channel: String, enabled: Boolean) {
        prefs.edit().putBoolean("channel_$channel", enabled).apply()
    }

    var agentEnabled: Boolean
        get() = isChannelEnabled(YuanioApp.CH_AGENT)
        set(value) = setChannelEnabled(YuanioApp.CH_AGENT, value)

    var approvalEnabled: Boolean
        get() = isChannelEnabled(YuanioApp.CH_APPROVAL)
        set(value) = setChannelEnabled(YuanioApp.CH_APPROVAL, value)

    var errorEnabled: Boolean
        get() = isChannelEnabled(YuanioApp.CH_ERROR)
        set(value) = setChannelEnabled(YuanioApp.CH_ERROR, value)

    var toolEnabled: Boolean
        get() = isChannelEnabled(YuanioApp.CH_TOOL)
        set(value) = setChannelEnabled(YuanioApp.CH_TOOL, value)
}


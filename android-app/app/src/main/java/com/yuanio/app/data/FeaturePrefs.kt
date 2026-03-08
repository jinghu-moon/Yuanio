package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences

object FeaturePrefs {
    private const val PREFS_NAME = "yuanio_feature_flags"
    private const val KEY_APPROVAL_AUTO_REJECT_ENABLED = "approval_auto_reject_enabled"
    private const val KEY_CHAT_SPLIT_PANE_ENABLED = "chat_split_pane_enabled"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    var approvalAutoRejectEnabled: Boolean
        get() = prefs.getBoolean(KEY_APPROVAL_AUTO_REJECT_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_APPROVAL_AUTO_REJECT_ENABLED, value).apply()

    var chatSplitPaneEnabled: Boolean
        get() = prefs.getBoolean(KEY_CHAT_SPLIT_PANE_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_CHAT_SPLIT_PANE_ENABLED, value).apply()
}

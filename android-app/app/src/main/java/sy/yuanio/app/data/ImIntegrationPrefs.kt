package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.StringRes
import sy.yuanio.app.R

enum class ImPlatform(val value: String, @param:StringRes @field:StringRes val labelRes: Int) {
    WECHAT_WORK("wechat_work", R.string.im_platform_wechat_work),
    DINGTALK("dingtalk", R.string.im_platform_dingtalk),
    FEISHU("feishu", R.string.im_platform_feishu);

    companion object {
        fun fromValue(v: String) = entries.firstOrNull { it.value == v } ?: WECHAT_WORK
    }
}

enum class WebhookEvent(
    val value: String,
    @param:StringRes @field:StringRes val labelRes: Int,
    @param:StringRes @field:StringRes val descRes: Int,
) {
    AGENT_ONLINE("agent_online", R.string.webhook_event_agent_online, R.string.webhook_event_agent_online_desc),
    AGENT_OFFLINE("agent_offline", R.string.webhook_event_agent_offline, R.string.webhook_event_agent_offline_desc),
    TASK_COMPLETE("task_complete", R.string.webhook_event_task_complete, R.string.webhook_event_task_complete_desc),
    ERROR("error", R.string.webhook_event_error, R.string.webhook_event_error_desc),
    APPROVAL("approval", R.string.webhook_event_approval, R.string.webhook_event_approval_desc);
}

object ImIntegrationPrefs {
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("im_integration", Context.MODE_PRIVATE)
    }

    var platform: ImPlatform
        get() = ImPlatform.fromValue(prefs.getString("platform", "wechat_work") ?: "wechat_work")
        set(v) = prefs.edit().putString("platform", v.value).apply()

    var webhookUrl: String
        get() = prefs.getString("webhook_url", "") ?: ""
        set(v) = prefs.edit().putString("webhook_url", v).apply()

    var enabledEvents: Set<String>
        get() = prefs.getStringSet("enabled_events", WebhookEvent.entries.map { it.value }.toSet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet("enabled_events", v).apply()

    fun isEventEnabled(event: WebhookEvent): Boolean = enabledEvents.contains(event.value)

    fun toggleEvent(event: WebhookEvent, enabled: Boolean) {
        val current = enabledEvents.toMutableSet()
        if (enabled) current.add(event.value) else current.remove(event.value)
        enabledEvents = current
    }
}


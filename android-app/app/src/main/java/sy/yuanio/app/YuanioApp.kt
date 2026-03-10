package sy.yuanio.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import sy.yuanio.app.data.NotificationPrefs
import sy.yuanio.app.data.TerminalPrefs
import sy.yuanio.app.data.TemplateStore
import sy.yuanio.app.data.ArtifactStore
import sy.yuanio.app.data.TtsPrefs
import sy.yuanio.app.data.LocalConnectionPrefs
import sy.yuanio.app.data.ImIntegrationPrefs
import sy.yuanio.app.data.VoiceInputPrefs
import sy.yuanio.app.data.ComposerStylePrefs
import sy.yuanio.app.data.FeaturePrefs
import sy.yuanio.app.data.DefaultSessionGateway
import sy.yuanio.app.data.SessionGateway
import sy.yuanio.app.data.WorkflowSnapshotStore
import sy.yuanio.app.ui.theme.LanguagePreference

class YuanioApp : Application() {
    val sessionGateway: SessionGateway by lazy { DefaultSessionGateway() }

    companion object {
        const val CH_AGENT = "agent_status"
        const val CH_TOOL = "tool_calls"
        const val CH_ERROR = "errors"
        const val CH_APPROVAL = "approval"
    }

    override fun onCreate() {
        super.onCreate()
        LanguagePreference.init(this)
        NotificationPrefs.init(this)
        TerminalPrefs.init(this)
        TemplateStore.init(this)
        ArtifactStore.init(this)
        TtsPrefs.init(this)
        VoiceInputPrefs.init(this)
        ComposerStylePrefs.init(this)
        FeaturePrefs.init(this)
        LocalConnectionPrefs.init(this)
        ImIntegrationPrefs.init(this)
        WorkflowSnapshotStore.init(this)

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_AGENT, getString(R.string.notification_channel_agent_name), NotificationManager.IMPORTANCE_LOW)
                .apply { description = getString(R.string.notification_channel_agent_desc) },
            NotificationChannel(CH_TOOL, getString(R.string.notification_channel_tool_name), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = getString(R.string.notification_channel_tool_desc) },
            NotificationChannel(CH_ERROR, getString(R.string.notification_channel_error_name), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = getString(R.string.notification_channel_error_desc) },
            NotificationChannel(CH_APPROVAL, getString(R.string.notification_channel_approval_name), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = getString(R.string.notification_channel_approval_desc) },
        ))
    }
}


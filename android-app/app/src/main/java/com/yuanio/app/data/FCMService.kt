package com.yuanio.app.data

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.yuanio.app.MainActivity
import com.yuanio.app.R
import com.yuanio.app.YuanioApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class FCMService : FirebaseMessagingService() {

    private data class NotificationAction(
        val action: String,
        val labelRes: Int,
        val approvalId: String? = null,
        val taskId: String? = null,
        val path: String? = null,
        val prompt: String? = null,
        val reason: String? = null,
    )

    private fun resolveChannel(eventType: String): String = when (eventType) {
        "approval_requested" -> YuanioApp.CH_APPROVAL
        "run_failed" -> YuanioApp.CH_ERROR
        "task_completed" -> YuanioApp.CH_AGENT
        else -> YuanioApp.CH_AGENT
    }

    private fun resolveTitle(eventType: String): String = when (eventType) {
        "approval_requested" -> getString(R.string.fcm_title_approval)
        "run_failed" -> getString(R.string.fcm_title_run_failed)
        else -> getString(R.string.fcm_title_default)
    }

    private fun resolveBody(eventType: String): String = when (eventType) {
        "approval_requested" -> getString(R.string.fcm_body_approval_requested)
        "run_failed" -> getString(R.string.fcm_body_run_failed)
        "task_completed" -> getString(R.string.fcm_body_task_completed)
        "agent_offline" -> getString(R.string.fcm_body_agent_offline)
        else -> getString(R.string.fcm_body_default)
    }

    private fun parseAvailableActions(data: Map<String, String>, eventType: String): List<String> {
        val raw = data["availableActions"]
            ?: data["actions"]
            ?: data["interactionActions"]
        if (!raw.isNullOrBlank()) {
            val parsed = raw.split(',', '|', ';')
                .map { it.trim().lowercase() }
                .filter { it.isNotBlank() }
            if (parsed.isNotEmpty()) return parsed
        }
        return when (eventType) {
            "approval_requested" -> listOf("approve", "reject")
            "run_failed" -> listOf("retry", "stop")
            "task_completed" -> listOf("continue")
            "agent_offline" -> listOf("retry")
            else -> emptyList()
        }
    }

    private fun buildNotificationActions(
        eventType: String,
        data: Map<String, String>,
    ): List<NotificationAction> {
        val approvalId = data["approvalId"]?.takeIf { it.isNotBlank() }
        val taskId = data["taskId"]?.takeIf { it.isNotBlank() }
        val rollbackPath = data["rollbackPath"]?.takeIf { it.isNotBlank() }
            ?: data["path"]?.takeIf { it.isNotBlank() }
        val reason = "push_$eventType"

        return parseAvailableActions(data, eventType).mapNotNull { action ->
            when (action) {
                "continue" -> NotificationAction(
                    action = "continue",
                    labelRes = R.string.chat_action_continue,
                    prompt = "continue",
                    taskId = taskId,
                    reason = reason,
                )
                "stop" -> NotificationAction(
                    action = "stop",
                    labelRes = R.string.chat_action_stop,
                    taskId = taskId,
                    reason = reason,
                )
                "retry" -> NotificationAction(
                    action = "retry",
                    labelRes = R.string.common_retry,
                    prompt = "continue",
                    taskId = taskId,
                    reason = reason,
                )
                "approve" -> approvalId?.let {
                    NotificationAction(
                        action = "approve",
                        labelRes = R.string.notifier_action_approve,
                        approvalId = it,
                        reason = reason,
                    )
                }
                "reject" -> approvalId?.let {
                    NotificationAction(
                        action = "reject",
                        labelRes = R.string.notifier_action_reject,
                        approvalId = it,
                        reason = reason,
                    )
                }
                "rollback" -> rollbackPath?.let {
                    NotificationAction(
                        action = "rollback",
                        labelRes = R.string.chat_action_rollback,
                        path = it,
                        reason = reason,
                    )
                }
                else -> null
            }
        }.take(3)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val keyStore = KeyStore(applicationContext)
        keyStore.fcmToken = token

        // token 轮转后尽快补登记；失败时由 ChatViewModel 在连接时再次兜底。
        val serverUrl = keyStore.serverUrl
        val sessionToken = keyStore.sessionToken
        if (!serverUrl.isNullOrBlank() && !sessionToken.isNullOrBlank()) {
            CoroutineScope(Dispatchers.IO).launch {
                runCatching { ApiClient(serverUrl).registerPushToken(sessionToken, token) }
                    .onFailure { e -> Log.w("FCMService", "register push token failed: ${e.message}") }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val eventType = message.data["eventType"]?.trim().orEmpty()
        if (eventType.isBlank()) {
            Log.w("FCMService", "drop push without eventType")
            return
        }
        val title = resolveTitle(eventType)
        val body = resolveBody(eventType)
        val channel = resolveChannel(eventType)

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "chat")
            message.data["sessionId"]?.let { putExtra("session_id", it) }
            message.data["messageId"]?.let { putExtra("message_id", it) }
            putExtra("eventType", eventType)
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val approvalId = message.data["approvalId"]
        val builder = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(
                if (channel == YuanioApp.CH_APPROVAL) NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT
            )

        val actions = buildNotificationActions(eventType, message.data)
        actions.forEachIndexed { index, action ->
            val requestCodeSeed = approvalId?.hashCode() ?: eventType.hashCode()
            builder.addAction(
                0,
                getString(action.labelRes),
                Notifier.buildInteractionActionPendingIntent(
                    ctx = this,
                    requestCode = requestCodeSeed + index + 1000,
                    action = action.action,
                    approvalId = action.approvalId,
                    taskId = action.taskId,
                    path = action.path,
                    prompt = action.prompt,
                    reason = action.reason,
                )
            )
        }

        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(approvalId?.hashCode() ?: System.currentTimeMillis().toInt(), builder.build())
    }
}

/**
 * 处理通知栏审批 Action 按钮。
 * Vault 锁定时先暂存，解锁后由 MainActivity 补发。
 */
class ApprovalResponseReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Notifier.ACTION_APPROVAL_RESPONSE) return

        val approvalId = intent.getStringExtra(Notifier.EXTRA_APPROVAL_ID) ?: return
        val action = intent.getStringExtra(Notifier.EXTRA_APPROVAL_ACTION) ?: return
        val payload = InteractionActionIntentPayload(
            action = if (action == "approve") "approve" else "reject",
            approvalId = approvalId,
            reason = "legacy_approval_notification",
        )
        queueOrSendInteractionAction(context, payload)
    }
}

class InteractionActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Notifier.ACTION_INTERACTION_ACTION) return
        val action = intent.getStringExtra(Notifier.EXTRA_INTERACTION_ACTION)?.trim()?.lowercase() ?: return
        val payload = InteractionActionIntentPayload(
            action = action,
            approvalId = intent.getStringExtra(Notifier.EXTRA_INTERACTION_APPROVAL_ID),
            taskId = intent.getStringExtra(Notifier.EXTRA_INTERACTION_TASK_ID),
            path = intent.getStringExtra(Notifier.EXTRA_INTERACTION_PATH),
            prompt = intent.getStringExtra(Notifier.EXTRA_INTERACTION_PROMPT),
            reason = intent.getStringExtra(Notifier.EXTRA_INTERACTION_REASON),
        )
        queueOrSendInteractionAction(context, payload)
    }
}

private fun queueOrSendInteractionAction(context: Context, payload: InteractionActionIntentPayload) {
    val keyStore = KeyStore(context)
    if (keyStore.isVaultConfigured && keyStore.isVaultLocked) {
        PendingInteractionActionStore(context).append(payload)
        return
    }
    val sent = sendInteractionAction(context, payload)
    if (!sent) {
        PendingInteractionActionStore(context).append(payload)
    }
}

fun sendApprovalResponse(context: Context, approvalId: String, approved: Boolean): Boolean {
    return sendInteractionAction(
        context = context,
        payload = InteractionActionIntentPayload(
            action = if (approved) "approve" else "reject",
            approvalId = approvalId,
            reason = "approval_response",
        )
    )
}

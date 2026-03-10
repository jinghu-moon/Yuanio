package sy.yuanio.app.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 处理通知栏交互 Action 按钮。
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
        sendOrQueueInteractionAction(context, payload)
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
        sendOrQueueInteractionAction(context, payload)
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

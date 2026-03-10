package sy.yuanio.app.data

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import sy.yuanio.app.R
import sy.yuanio.app.YuanioApp

object Notifier {
    private var nextId = 1000

    // 审批通知使用 approvalId 的 hashCode 作为通知 ID，便于后续取消
    const val ACTION_APPROVAL_RESPONSE = "sy.yuanio.app.ACTION_APPROVAL_RESPONSE"
    const val ACTION_INTERACTION_ACTION = "sy.yuanio.app.ACTION_INTERACTION_ACTION"
    const val EXTRA_APPROVAL_ID = "approval_id"
    const val EXTRA_APPROVAL_ACTION = "approval_action"
    const val EXTRA_INTERACTION_ACTION = "interaction_action"
    const val EXTRA_INTERACTION_APPROVAL_ID = "interaction_approval_id"
    const val EXTRA_INTERACTION_TASK_ID = "interaction_task_id"
    const val EXTRA_INTERACTION_PATH = "interaction_path"
    const val EXTRA_INTERACTION_PROMPT = "interaction_prompt"
    const val EXTRA_INTERACTION_REASON = "interaction_reason"

    fun agentStatus(ctx: Context, title: String, body: String) =
        send(ctx, YuanioApp.CH_AGENT, title, body)

    fun toolCall(ctx: Context, tool: String, status: String) =
        send(ctx, YuanioApp.CH_TOOL, ctx.getString(R.string.notifier_tool_title, tool), status)

    fun error(ctx: Context, msg: String) =
        send(ctx, YuanioApp.CH_ERROR, ctx.getString(R.string.notifier_error_title), msg)

    fun approval(ctx: Context, desc: String, approvalId: String? = null) {
        if (!NotificationPrefs.isChannelEnabled(YuanioApp.CH_APPROVAL)) return

        val notifId = approvalId?.hashCode() ?: nextId++

        val builder = NotificationCompat.Builder(ctx, YuanioApp.CH_APPROVAL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(ctx.getString(R.string.notifier_approval_title))
            .setContentText(desc)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)

        // 添加"批准"和"拒绝" Action 按钮
        if (approvalId != null) {
            builder.addAction(
                0,
                ctx.getString(R.string.notifier_action_approve),
                buildInteractionActionPendingIntent(
                    ctx = ctx,
                    requestCode = approvalId.hashCode(),
                    action = "approve",
                    approvalId = approvalId,
                    reason = "approval_notification",
                )
            )
            builder.addAction(
                0,
                ctx.getString(R.string.notifier_action_reject),
                buildInteractionActionPendingIntent(
                    ctx = ctx,
                    requestCode = approvalId.hashCode() + 1,
                    action = "reject",
                    approvalId = approvalId,
                    reason = "approval_notification",
                )
            )
        }

        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, builder.build())
    }

    /** 取消指定审批通知 */
    fun cancelApprovalNotification(ctx: Context, approvalId: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(approvalId.hashCode())
    }

    fun buildInteractionActionPendingIntent(
        ctx: Context,
        requestCode: Int,
        action: String,
        approvalId: String? = null,
        taskId: String? = null,
        path: String? = null,
        prompt: String? = null,
        reason: String? = null,
    ): PendingIntent {
        val intent = Intent(ACTION_INTERACTION_ACTION).apply {
            setPackage(ctx.packageName)
            putExtra(EXTRA_INTERACTION_ACTION, action)
            approvalId?.let { putExtra(EXTRA_INTERACTION_APPROVAL_ID, it) }
            taskId?.let { putExtra(EXTRA_INTERACTION_TASK_ID, it) }
            path?.let { putExtra(EXTRA_INTERACTION_PATH, it) }
            prompt?.let { putExtra(EXTRA_INTERACTION_PROMPT, it) }
            reason?.let { putExtra(EXTRA_INTERACTION_REASON, it) }
        }
        return PendingIntent.getBroadcast(
            ctx,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun send(ctx: Context, channel: String, title: String, body: String) {
        if (!NotificationPrefs.isChannelEnabled(channel)) return

        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(nextId++, n)
    }
}


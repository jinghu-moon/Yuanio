package com.yuanio.app.data

import android.content.Context
import android.util.Log
import org.json.JSONObject

data class InteractionActionIntentPayload(
    val action: String,
    val approvalId: String? = null,
    val taskId: String? = null,
    val path: String? = null,
    val prompt: String? = null,
    val reason: String? = null,
    val source: String = "notification",
)

private val ALLOWED_INTERACTION_ACTIONS = setOf(
    "continue",
    "stop",
    "approve",
    "reject",
    "retry",
    "rollback",
)

fun sendInteractionAction(
    context: Context,
    payload: InteractionActionIntentPayload,
): Boolean {
    val normalized = payload.action.trim().lowercase()
    if (normalized !in ALLOWED_INTERACTION_ACTIONS) return false

    val keyStore = KeyStore(context)
    val key = keyStore.sharedKey ?: return false
    val deviceId = keyStore.deviceId ?: return false
    val sessionId = keyStore.sessionId ?: return false
    val url = keyStore.serverUrl ?: return false
    val token = keyStore.sessionToken ?: return false

    val plaintext = JSONObject()
        .put("action", normalized)
        .put("source", payload.source)
        .apply {
            payload.approvalId?.takeIf { it.isNotBlank() }?.let { put("approvalId", it) }
            payload.taskId?.takeIf { it.isNotBlank() }?.let { put("taskId", it) }
            payload.path?.takeIf { it.isNotBlank() }?.let { put("path", it) }
            payload.prompt?.takeIf { it.isNotBlank() }?.let { put("prompt", it) }
            payload.reason?.takeIf { it.isNotBlank() }?.let { put("reason", it) }
        }
        .toString()

    val envelope = EnvelopeHelper.create(
        source = deviceId,
        target = "broadcast",
        sessionId = sessionId,
        type = "interaction_action",
        plaintext = plaintext,
        sharedKey = key,
    )

    val relay = RelayClient(url, token)
    relay.onStateChange = { state ->
        if (state == ConnectionState.CONNECTED) {
            relay.send(envelope)
            if ((normalized == "approve" || normalized == "reject") && !payload.approvalId.isNullOrBlank()) {
                Notifier.cancelApprovalNotification(context, payload.approvalId)
            }
            relay.disconnect()
        }
    }
    relay.onError = { err ->
        Log.w("InteractionAction", "notification dispatch failed: $err")
    }
    relay.connect()
    return true
}


package sy.yuanio.app.data

import org.json.JSONObject

enum class RelayAckState(val wireValue: String) {
    OK("ok"),
    WORKING("working"),
    RETRY_AFTER("retry_after"),
    TERMINAL("terminal");

    companion object {
        fun fromWire(value: String?): RelayAckState = when (value) {
            WORKING.wireValue -> WORKING
            RETRY_AFTER.wireValue -> RETRY_AFTER
            TERMINAL.wireValue -> TERMINAL
            else -> OK
        }
    }
}

data class RelayAck(
    val messageId: String,
    val state: RelayAckState = RelayAckState.OK,
    val retryAfterMs: Long? = null,
    val reason: String? = null,
    val at: Long? = null,
)

private fun parseLong(raw: Any?): Long? = when (raw) {
    is Int -> raw.toLong()
    is Long -> raw
    is Double -> if (raw.isFinite()) raw.toLong() else null
    is Float -> if (raw.isFinite()) raw.toLong() else null
    is String -> raw.toLongOrNull()
    else -> null
}

internal fun parseRelayAck(raw: Any?): RelayAck? {
    return when (raw) {
        is JSONObject -> {
            val messageId = raw.optString("messageId")
            if (messageId.isBlank()) return null
            RelayAck(
                messageId = messageId,
                state = RelayAckState.fromWire(raw.optString("state", RelayAckState.OK.wireValue)),
                retryAfterMs = parseLong(raw.opt("retryAfterMs"))?.coerceAtLeast(0L),
                reason = raw.optString("reason").takeIf { it.isNotBlank() },
                at = parseLong(raw.opt("at")),
            )
        }
        is Map<*, *> -> {
            val messageId = raw["messageId"] as? String ?: return null
            RelayAck(
                messageId = messageId,
                state = RelayAckState.fromWire(raw["state"] as? String),
                retryAfterMs = parseLong(raw["retryAfterMs"])?.coerceAtLeast(0L),
                reason = raw["reason"] as? String,
                at = parseLong(raw["at"]),
            )
        }
        else -> null
    }
}

internal fun extractRelayAckFromEnvelope(envelope: JSONObject): RelayAck? {
    if (envelope.optString("type") != "ack") return null
    parseRelayAck(envelope)?.let { return it }
    return when (val payload = envelope.opt("payload")) {
        is JSONObject -> parseRelayAck(payload)
        is String -> runCatching { parseRelayAck(JSONObject(payload)) }.getOrNull()
        else -> null
    }
}


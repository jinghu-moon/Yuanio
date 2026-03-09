package com.yuanio.app.data

import android.content.Context
import com.yuanio.app.YuanioApp
import org.json.JSONObject

private const val AGENT_COMMAND_TARGET = "broadcast"
private const val AGENT_COMMAND_TYPE = "prompt"

internal data class AgentCommandEnvelopeInput(
    val source: String,
    val target: String,
    val sessionId: String,
    val type: String,
    val plaintext: String,
    val sharedKey: ByteArray,
)

internal fun buildAgentCommandEnvelopeInput(
    command: String,
    sharedKey: ByteArray?,
    deviceId: String?,
    sessionId: String?,
): AgentCommandEnvelopeInput? {
    val normalizedCommand = command.trim()
    if (normalizedCommand.isBlank()) return null
    val normalizedKey = sharedKey ?: return null
    val normalizedDeviceId = deviceId?.trim().orEmpty()
    val normalizedSessionId = sessionId?.trim().orEmpty()
    if (normalizedDeviceId.isBlank() || normalizedSessionId.isBlank()) return null
    return AgentCommandEnvelopeInput(
        source = normalizedDeviceId,
        target = AGENT_COMMAND_TARGET,
        sessionId = normalizedSessionId,
        type = AGENT_COMMAND_TYPE,
        plaintext = normalizedCommand,
        sharedKey = normalizedKey,
    )
}

internal fun createAgentCommandEnvelope(
    command: String,
    sharedKey: ByteArray?,
    deviceId: String?,
    sessionId: String?,
): JSONObject? {
    val input = buildAgentCommandEnvelopeInput(
        command = command,
        sharedKey = sharedKey,
        deviceId = deviceId,
        sessionId = sessionId,
    ) ?: return null
    return EnvelopeHelper.create(
        source = input.source,
        target = input.target,
        sessionId = input.sessionId,
        type = input.type,
        plaintext = input.plaintext,
        sharedKey = input.sharedKey,
    )
}

internal fun sendAgentCommandEnvelope(
    transport: MessageTransport,
    envelope: JSONObject,
): Boolean {
    return runCatching {
        transport.send(envelope)
        true
    }.getOrDefault(false)
}

internal fun connectAndSendAgentCommand(
    transport: MessageTransport,
    envelope: JSONObject,
): Boolean {
    return runCatching {
        var dispatched = false
        transport.onStateChange = { state ->
            if (state == ConnectionState.CONNECTED && !dispatched) {
                dispatched = true
                sendAgentCommandEnvelope(transport, envelope)
                transport.disconnect()
            }
        }
        transport.connect()
        true
    }.getOrDefault(false)
}

fun sendAgentCommand(
    context: Context,
    command: String,
): Boolean {
    val keyStore = KeyStore(context)
    val envelope = createAgentCommandEnvelope(
        command = command,
        sharedKey = keyStore.sharedKey,
        deviceId = keyStore.deviceId,
        sessionId = keyStore.sessionId,
    ) ?: return false

    val activeTransport = (context.applicationContext as? YuanioApp)
        ?.sessionGateway
        ?.transport
    if (activeTransport?.isConnected == true) {
        return sendAgentCommandEnvelope(activeTransport, envelope)
    }

    val serverUrl = keyStore.serverUrl ?: return false
    val sessionToken = keyStore.sessionToken ?: return false
    return connectAndSendAgentCommand(RelayClient(serverUrl, sessionToken), envelope)
}

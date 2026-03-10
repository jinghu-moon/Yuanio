package sy.yuanio.app.data

import org.json.JSONArray
import org.json.JSONObject

const val SESSION_GATEWAY_ERROR_LOCAL_UNAVAILABLE_MISSING_KEY = "session_gateway.local_unavailable_missing_key"

data class SessionGatewayConfig(
    val serverUrl: String,
    val sessionToken: String,
    val sessionId: String,
    val preferredConnectionMode: ConnectionMode,
    val manualIp: String = "",
    val manualPort: Int = 9394,
    val deviceId: String? = null,
    val localAuthKeyBytes: ByteArray? = null,
)

data class SessionGatewaySnapshot(
    val sessionId: String? = null,
    val preferredConnectionMode: ConnectionMode = ConnectionMode.AUTO,
    val connectionType: String = "relay",
    val isConnected: Boolean = false,
)

data class SessionGatewayCallbacks(
    val onMessage: (JSONObject) -> Unit = {},
    val onBinaryMessage: (JSONObject, ByteArray) -> Unit = { _, _ -> },
    val onStateChange: (ConnectionState) -> Unit = {},
    val onError: (String) -> Unit = {},
    val onAck: (RelayAck) -> Unit = {},
    val onDeviceOnline: () -> Unit = {},
    val onDeviceOffline: () -> Unit = {},
    val onDeviceList: (JSONArray) -> Unit = {},
    val onConnectionTypeChange: (String) -> Unit = {},
)

interface SessionGateway {
    val transport: MessageTransport?

    fun bind(callbacks: SessionGatewayCallbacks)

    fun connect(config: SessionGatewayConfig)

    fun switchSession(config: SessionGatewayConfig)

    fun disconnect()

    fun reconnect()

    fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState = RelayAckState.OK,
        retryAfterMs: Long? = null,
        reason: String? = null,
    )

    fun snapshot(): SessionGatewaySnapshot
}

internal interface GatewayTransport : MessageTransport {
    var onAck: ((RelayAck) -> Unit)?
    var onDeviceOnline: (() -> Unit)?
    var onDeviceOffline: (() -> Unit)?
    var onDeviceList: ((JSONArray) -> Unit)?

    fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState = RelayAckState.OK,
        retryAfterMs: Long? = null,
        reason: String? = null,
    )
}


package sy.yuanio.app.data

import org.json.JSONArray
import org.json.JSONObject

enum class ConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

/**
 * 兼容旧调用方式的 Relay 客户端，内部使用原生 WebSocket 协议。
 */
open class RelayClient(
    serverUrl: String,
    sessionToken: String,
    namespace: String = "",
    deviceId: String = "",
    role: String = "",
    protocolVersion: String = PROTOCOL_VERSION,
) : MessageTransport {

    override var onMessage: ((JSONObject) -> Unit)?
        get() = client.onMessage
        set(value) {
            client.onMessage = value
        }

    override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)?
        get() = client.onBinaryMessage
        set(value) {
            client.onBinaryMessage = value
        }

    override var onStateChange: ((ConnectionState) -> Unit)?
        get() = stateChange
        set(value) {
            stateChange = value
            client.onStateChange = value
        }

    override var onError: ((String) -> Unit)?
        get() = client.onError
        set(value) {
            client.onError = value
        }

    var onDeviceOnline: (() -> Unit)?
        get() = client.onDeviceOnline
        set(value) {
            client.onDeviceOnline = value
        }

    var onDeviceOffline: (() -> Unit)?
        get() = client.onDeviceOffline
        set(value) {
            client.onDeviceOffline = value
        }

    var onDeviceList: ((JSONArray) -> Unit)?
        get() = client.onDeviceList
        set(value) {
            client.onDeviceList = value
        }

    var onAck: ((RelayAck) -> Unit)?
        get() = client.onAck
        set(value) {
            client.onAck = value
        }

    private val client = RelayWebSocketClient(
        serverUrl = serverUrl,
        sessionToken = sessionToken,
        namespace = namespace,
        deviceId = deviceId,
        role = role,
        protocolVersion = protocolVersion,
    )

    private var stateChange: ((ConnectionState) -> Unit)? = null

    override fun connect() {
        client.connect()
    }

    override fun send(envelope: JSONObject) {
        client.send(envelope)
    }

    override fun sendBinary(header: JSONObject, payload: ByteArray) {
        client.sendBinary(header, payload)
    }

    open fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState = RelayAckState.OK,
        retryAfterMs: Long? = null,
        reason: String? = null,
    ) {
        client.sendAck(messageId, source, sessionId, state, retryAfterMs, reason)
    }

    override fun disconnect() {
        client.disconnect()
    }

    override fun reconnect() {
        stateChange?.invoke(ConnectionState.RECONNECTING)
        client.reconnect()
    }

    override val isConnected: Boolean
        get() = client.isConnected
}

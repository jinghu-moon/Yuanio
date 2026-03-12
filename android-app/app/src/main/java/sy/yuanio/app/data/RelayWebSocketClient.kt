package sy.yuanio.app.data

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Relay WebSocket 客户端：/relay-ws
 * 使用原生 WS frame（hello/message/ack/presence/error）替代 Socket.IO。
 */
class RelayWebSocketClient(
    private val serverUrl: String,
    private val sessionToken: String,
    private val namespace: String = DEFAULT_NAMESPACE,
    private val deviceId: String = "",
    private val role: String = DEFAULT_ROLE,
    private val protocolVersion: String = PROTOCOL_VERSION,
) : GatewayTransport {

    override var onMessage: ((JSONObject) -> Unit)? = null
    override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)? = null
    override var onStateChange: ((ConnectionState) -> Unit)? = null
    override var onError: ((String) -> Unit)? = null
    override var onAck: ((RelayAck) -> Unit)? = null
    override var onDeviceOnline: (() -> Unit)? = null
    override var onDeviceOffline: (() -> Unit)? = null
    override var onDeviceList: ((JSONArray) -> Unit)? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .pingInterval(PING_INTERVAL_SEC, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    @Volatile
    private var connected = false
    private var lastAgentOnline: Boolean? = null

    override val isConnected: Boolean
        get() = ws != null && connected

    override fun connect() {
        if (ws != null) return
        val url = buildRelayWsUrl(serverUrl)
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected = true
                onStateChange?.invoke(ConnectionState.CONNECTED)
                sendHello(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleTextFrame(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                handleTextFrame(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected = false
                onStateChange?.invoke(ConnectionState.DISCONNECTED)
                onError?.invoke(t.message ?: "Relay WebSocket failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
                onStateChange?.invoke(ConnectionState.DISCONNECTED)
            }
        })
    }

    override fun disconnect() {
        connected = false
        ws?.close(1000, "client disconnect")
        ws = null
    }

    override fun reconnect() {
        disconnect()
        connect()
    }

    override fun send(envelope: JSONObject) {
        if (!isConnected) return
        val frame = JSONObject()
            .put("type", "message")
            .put("data", envelope)
        ws?.send(frame.toString())
    }

    override fun sendBinary(header: JSONObject, payload: ByteArray) {
        if (!isConnected) return
        header.put("payload", Base64.encodeToString(payload, Base64.NO_WRAP))
        val frame = JSONObject()
            .put("type", "message")
            .put("data", header)
        ws?.send(frame.toString())
    }

    override fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState,
        retryAfterMs: Long?,
        reason: String?,
    ) {
        if (!isConnected) return
        val ack = JSONObject()
            .put("messageId", messageId)
            .put("source", source)
            .put("sessionId", sessionId)
            .put("state", state.wireValue)
            .put("at", System.currentTimeMillis())
        if (retryAfterMs != null) ack.put("retryAfterMs", retryAfterMs)
        if (!reason.isNullOrBlank()) ack.put("reason", reason)
        val frame = JSONObject()
            .put("type", "ack")
            .put("data", ack)
        ws?.send(frame.toString())
    }

    private fun sendHello(webSocket: WebSocket) {
        val frame = buildHelloFrame(
            sessionToken,
            protocolVersion,
            namespace,
            deviceId,
            role,
        )
        webSocket.send(frame.toString())
    }

    private fun handleTextFrame(raw: String) {
        val frame = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (frame.optString("type")) {
            "message" -> {
                val data = frame.optJSONObject("data") ?: return
                val payload = data.opt("payload")
                val binary = decodeBinaryPayload(payload)
                if (binary != null) {
                    data.remove("payload")
                    onBinaryMessage?.invoke(data, binary)
                } else {
                    onMessage?.invoke(data)
                }
            }
            "ack" -> {
                val ack = parseRelayAck(frame.opt("data")) ?: return
                onAck?.invoke(ack)
            }
            "presence" -> {
                val data = frame.optJSONObject("data") ?: return
                val devices = data.optJSONArray("devices") ?: return
                val normalized = JSONArray()
                var hasAgent = false
                for (i in 0 until devices.length()) {
                    val obj = devices.optJSONObject(i) ?: continue
                    val id = obj.optString("id")
                    val role = obj.optString("role")
                    if (role == "agent") hasAgent = true
                    normalized.put(
                        JSONObject()
                            .put("deviceId", id)
                            .put("role", role)
                    )
                }
                onDeviceList?.invoke(normalized)
                syncAgentPresence(hasAgent)
            }
            "error" -> {
                val data = frame.optJSONObject("data")
                val code = data?.optString("code").orEmpty()
                val message = data?.optString("message").orEmpty()
                val info = listOf(code, message).filter { it.isNotBlank() }.joinToString(": ")
                if (info.isNotBlank()) onError?.invoke(info)
            }
        }
    }

    private fun syncAgentPresence(hasAgent: Boolean) {
        val previous = lastAgentOnline
        lastAgentOnline = hasAgent
        if (previous == null) return
        if (hasAgent && previous == false) onDeviceOnline?.invoke()
        if (!hasAgent && previous == true) onDeviceOffline?.invoke()
    }

    private fun decodeBinaryPayload(payload: Any?): ByteArray? {
        return when (payload) {
            is JSONObject -> decodeBufferPayload(payload)
            is JSONArray -> decodeArrayPayload(payload)
            else -> null
        }
    }

    private fun decodeBufferPayload(payload: JSONObject): ByteArray? {
        if (payload.optString("type") != "Buffer") return null
        val data = payload.optJSONArray("data") ?: return null
        return decodeArrayPayload(data)
    }

    private fun decodeArrayPayload(data: JSONArray): ByteArray {
        val bytes = ByteArray(data.length())
        for (i in 0 until data.length()) {
            bytes[i] = data.optInt(i, 0).toByte()
        }
        return bytes
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 5_000L
        private const val PING_INTERVAL_SEC = 15L
        private const val DEFAULT_NAMESPACE = "default"
        private const val DEFAULT_ROLE = "app"

        @JvmStatic
        fun buildHelloFrame(
            token: String,
            protocolVersion: String,
            namespace: String,
            deviceId: String,
            role: String,
        ): JSONObject {
            val data = JSONObject()
                .put("token", token)
                .put("protocolVersion", protocolVersion)
                .put("namespace", namespace)
                .put("deviceId", deviceId)
                .put("role", role)
            return JSONObject()
                .put("type", "hello")
                .put("data", data)
        }

        internal fun buildRelayWsUrl(serverUrl: String): String {
            val trimmed = serverUrl.trimEnd('/')
            val wsBase = when {
                trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}"
                trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}"
                trimmed.startsWith("ws://") || trimmed.startsWith("wss://") -> trimmed
                else -> "wss://$trimmed"
            }
            return "$wsBase/relay-ws"
        }
    }
}

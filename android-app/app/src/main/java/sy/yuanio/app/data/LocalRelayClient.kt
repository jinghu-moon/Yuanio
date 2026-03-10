package sy.yuanio.app.data

import okhttp3.*
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * 局域网直连 WebSocket 客户端，实现 MessageTransport 接口。
 * 通过原生 WebSocket 直连 Agent 本地服务器，绕过 Relay 降低延迟。
 *
 * WS 升级时附带 HMAC-SHA256 鉴权参数。
 */
class LocalRelayClient(
    private val host: String,
    private val port: Int,
    private val deviceId: String = "",
    private val authKeyBytes: ByteArray? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val nonceProvider: () -> String = { UUID.randomUUID().toString().take(16) },
) : MessageTransport {

    override var onMessage: ((JSONObject) -> Unit)? = null
    override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)? = null
    override var onStateChange: ((ConnectionState) -> Unit)? = null
    override var onError: ((String) -> Unit)? = null
    var onAck: ((RelayAck) -> Unit)? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    override val isConnected: Boolean get() = ws != null && _connected

    @Volatile
    private var _connected = false

    override fun connect() {
        val url = buildAuthUrl()
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connected = true
                onStateChange?.invoke(ConnectionState.CONNECTED)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val json = JSONObject(text)
                    val ack = extractRelayAckFromEnvelope(json)
                    if (ack != null) {
                        onAck?.invoke(ack)
                        return@runCatching
                    }
                    val payload = json.opt("payload")
                    if (payload is String) {
                        // 尝试解析为 binary base64 — 直连模式暂不走 binary
                        onMessage?.invoke(json)
                    } else {
                        onMessage?.invoke(json)
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _connected = false
                onStateChange?.invoke(ConnectionState.DISCONNECTED)
                onError?.invoke(t.message ?: "Local connection failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connected = false
                onStateChange?.invoke(ConnectionState.DISCONNECTED)
            }
        })
    }

    override fun send(envelope: JSONObject) {
        if (_connected) ws?.send(envelope.toString())
    }

    override fun sendBinary(header: JSONObject, payload: ByteArray) {
        // 直连模式将 payload 以 base64 内嵌发送
        header.put("payload", android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP))
        if (_connected) ws?.send(header.toString())
    }

    override fun disconnect() {
        _connected = false
        ws?.close(1000, "client disconnect")
        ws = null
    }

    override fun reconnect() {
        disconnect()
        connect()
    }

    /**
     * 构建带 HMAC 鉴权参数的 WS URL。
     * 如果没有提供 deviceId 或 authKeyBytes，则回退到无鉴权 URL。
     */
    internal fun buildAuthUrl(): String {
        if (deviceId.isEmpty() || authKeyBytes == null) {
            return "ws://$host:$port/ws"
        }

        val nonce = nonceProvider()
        val ts = clock().toString()
        val sig = hmacSha256(authKeyBytes, "$deviceId$nonce$ts")
        return "ws://$host:$port/ws?deviceId=$deviceId&nonce=$nonce&ts=$ts&sig=$sig"
    }

    companion object {
        const val LOCAL_HMAC_INFO = "yuanio-local-hmac-v1"
        internal const val CONNECT_TIMEOUT_MS = 1800L

        internal fun extractAckMessageId(envelope: JSONObject): String {
            return extractRelayAckFromEnvelope(envelope)?.messageId ?: ""
        }

        /**
         * 计算 HMAC-SHA256 并返回十六进制字符串。
         */
        fun hmacSha256(key: ByteArray, message: String): String {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            val hash = mac.doFinal(message.toByteArray(Charsets.UTF_8))
            return hash.joinToString("") { "%02x".format(it) }
        }
    }
}


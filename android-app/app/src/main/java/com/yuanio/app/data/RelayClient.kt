package com.yuanio.app.data

import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import java.net.URI

enum class ConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

internal fun buildRelaySocketOptions(sessionToken: String, preferWebSocket: Boolean): IO.Options {
    val transports = arrayOf(WebSocket.NAME)
    return IO.Options().apply {
        auth = mapOf(
            "token" to sessionToken,
            "protocolVersion" to PROTOCOL_VERSION,
        )
        reconnection = true
        reconnectionDelay = 300
        reconnectionDelayMax = 5000
        randomizationFactor = 0.2
        timeout = 5000
        rememberUpgrade = false
        upgrade = false
        this.transports = transports
    }
}

internal fun applyTransportFallback(options: IO.Options): Boolean {
    // 延迟优先：禁用 polling 回退，避免长尾抖动。
    val transports = options.transports
    if (transports.isNullOrEmpty()) return false
    return false
}

open class RelayClient(serverUrl: String, sessionToken: String) : MessageTransport {

    override var onMessage: ((JSONObject) -> Unit)? = null
    override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)? = null
    var onDeviceOnline: (() -> Unit)? = null
    var onDeviceOffline: (() -> Unit)? = null
    var onDeviceList: ((org.json.JSONArray) -> Unit)? = null
    override var onStateChange: ((ConnectionState) -> Unit)? = null
    var onAck: ((RelayAck) -> Unit)? = null
    override var onError: ((String) -> Unit)? = null

    private val socket: Socket
    private val options: IO.Options
    private var fallbackApplied = false

    init {
        options = buildRelaySocketOptions(sessionToken, preferWebSocket = true)
        socket = IO.socket(URI.create("$serverUrl/relay"), options)
        setupListeners()
    }

    private fun setupListeners() {
        socket.on(Socket.EVENT_CONNECT) {
            onStateChange?.invoke(ConnectionState.CONNECTED)
        }
        socket.on(Socket.EVENT_DISCONNECT) {
            onStateChange?.invoke(ConnectionState.DISCONNECTED)
        }
        socket.on(Socket.EVENT_CONNECT_ERROR) {
            onStateChange?.invoke(ConnectionState.RECONNECTING)
            val err = it.firstOrNull()
            val msg = when (err) {
                is Exception -> err.message ?: err.toString()
                is String -> err
                is JSONObject -> err.optString("message", err.toString())
                else -> err?.toString() ?: "Connection failed"
            }
            onError?.invoke(msg)
            if (!fallbackApplied && applyTransportFallback(options)) {
                fallbackApplied = true
                socket.disconnect()
                socket.connect()
            }
        }
        socket.on("message") { args ->
            if (args.isEmpty()) return@on
            val env = args[0] as? JSONObject ?: return@on
            // Socket.IO 自动将 Uint8Array 字段还原为 byte[]
            val payload = env.opt("payload")
            if (payload is ByteArray) {
                env.remove("payload")
                onBinaryMessage?.invoke(env, payload)
            } else {
                onMessage?.invoke(env)
            }
        }
        socket.on("device:online") { onDeviceOnline?.invoke() }
        socket.on("device:offline") { onDeviceOffline?.invoke() }
        socket.on("device_list") { args ->
            if (args.isNotEmpty() && args[0] is org.json.JSONArray) {
                onDeviceList?.invoke(args[0] as org.json.JSONArray)
            }
        }
        socket.on("ack") { args ->
            if (args.isEmpty()) return@on
            val ack = parseRelayAck(args[0]) ?: return@on
            onAck?.invoke(ack)
        }
    }

    override fun connect() { socket.connect() }
    override fun send(envelope: JSONObject) {
        if (socket.connected()) socket.emit("message", envelope)
    }
    /** Binary 信封：header + 原始加密字节，省去 Base64 膨胀 33% */
    override fun sendBinary(header: JSONObject, payload: ByteArray) {
        if (socket.connected()) {
            header.put("payload", payload)
            socket.emit("message", header)
        }
    }

    open fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState = RelayAckState.OK,
        retryAfterMs: Long? = null,
        reason: String? = null,
    ) {
        if (!socket.connected()) return
        val ack = JSONObject()
            .put("messageId", messageId)
            .put("source", source)
            .put("sessionId", sessionId)
            .put("state", state.wireValue)
            .put("at", System.currentTimeMillis())
        if (retryAfterMs != null) ack.put("retryAfterMs", retryAfterMs)
        if (!reason.isNullOrBlank()) ack.put("reason", reason)
        socket.emit("ack", ack)
    }

    fun registerFcmToken(token: String) {
        if (socket.connected()) {
            val data = JSONObject().put("token", token)
            socket.emit("register_fcm_token", data)
        }
    }
    override fun disconnect() { socket.disconnect() }
    override fun reconnect() { socket.disconnect(); socket.connect() }
    override val isConnected: Boolean get() = socket.connected()
}

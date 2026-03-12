package sy.yuanio.app.data

import org.json.JSONArray

internal class DefaultSessionGateway(
    private val relayFactory: (String, String) -> GatewayTransport = { serverUrl, sessionToken ->
        RelayGatewayTransport(RelayWebSocketClient(serverUrl, sessionToken))
    },
    private val localFactory: (SessionGatewayConfig) -> GatewayTransport = { config ->
        LocalGatewayTransport(
            LocalRelayClient(
                host = config.manualIp,
                port = config.manualPort,
                deviceId = config.deviceId.orEmpty(),
                authKeyBytes = config.localAuthKeyBytes,
            )
        )
    },
) : SessionGateway {

    private var callbacks: SessionGatewayCallbacks = SessionGatewayCallbacks()
    private var activeTransport: GatewayTransport? = null
    private var currentConfig: SessionGatewayConfig? = null
    private var currentSnapshot: SessionGatewaySnapshot = SessionGatewaySnapshot()

    override val transport: MessageTransport?
        get() = activeTransport

    override fun bind(callbacks: SessionGatewayCallbacks) {
        this.callbacks = callbacks
    }

    override fun connect(config: SessionGatewayConfig) {
        currentConfig = config
        if (shouldUseLocal(config)) {
            connectLocal(config)
        } else {
            connectRelay(config)
        }
    }

    override fun switchSession(config: SessionGatewayConfig) {
        connect(config)
    }

    override fun disconnect() {
        val previous = activeTransport
        activeTransport = null
        previous?.disconnect()
        currentSnapshot = currentSnapshot.copy(isConnected = false)
    }

    override fun reconnect() {
        currentConfig?.let(::connect)
    }

    override fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState,
        retryAfterMs: Long?,
        reason: String?,
    ) {
        activeTransport?.sendAck(messageId, source, sessionId, state, retryAfterMs, reason)
    }

    override fun snapshot(): SessionGatewaySnapshot = currentSnapshot

    private fun shouldUseLocal(config: SessionGatewayConfig): Boolean = when (config.preferredConnectionMode) {
        ConnectionMode.LOCAL -> true
        ConnectionMode.RELAY -> false
        ConnectionMode.AUTO -> config.manualIp.isNotBlank()
    }

    private fun isLocalReady(config: SessionGatewayConfig): Boolean {
        return config.manualIp.isNotBlank()
            && !config.deviceId.isNullOrBlank()
            && config.localAuthKeyBytes != null
    }

    private fun connectLocal(config: SessionGatewayConfig) {
        if (!isLocalReady(config)) {
            if (config.preferredConnectionMode == ConnectionMode.AUTO) {
                connectRelay(config)
            } else {
                replaceTransport(null, config, "local", isConnected = false)
                callbacks.onStateChange(ConnectionState.DISCONNECTED)
                callbacks.onError(SESSION_GATEWAY_ERROR_LOCAL_UNAVAILABLE_MISSING_KEY)
            }
            return
        }

        val transport = localFactory(config)
        attachTransport(
            transport = transport,
            config = config,
            connectionType = "local",
            autoFallbackToRelay = config.preferredConnectionMode == ConnectionMode.AUTO,
        )
        transport.connect()
    }

    private fun connectRelay(config: SessionGatewayConfig) {
        val transport = relayFactory(config.serverUrl, config.sessionToken)
        attachTransport(
            transport = transport,
            config = config,
            connectionType = "relay",
            autoFallbackToRelay = false,
        )
        transport.connect()
    }

    private fun attachTransport(
        transport: GatewayTransport,
        config: SessionGatewayConfig,
        connectionType: String,
        autoFallbackToRelay: Boolean,
    ) {
        replaceTransport(transport, config, connectionType, isConnected = false)

        transport.onMessage = { message ->
            if (activeTransport === transport) callbacks.onMessage(message)
        }
        transport.onBinaryMessage = { header, payload ->
            if (activeTransport === transport) callbacks.onBinaryMessage(header, payload)
        }
        transport.onAck = { ack ->
            if (activeTransport === transport) callbacks.onAck(ack)
        }
        transport.onDeviceOnline = {
            if (activeTransport === transport) callbacks.onDeviceOnline()
        }
        transport.onDeviceOffline = {
            if (activeTransport === transport) callbacks.onDeviceOffline()
        }
        transport.onDeviceList = { arr ->
            if (activeTransport === transport) callbacks.onDeviceList(arr)
        }
        transport.onError = { error ->
            if (activeTransport === transport) callbacks.onError(error)
        }
        transport.onStateChange = { state ->
            if (activeTransport === transport) {
                currentSnapshot = currentSnapshot.copy(isConnected = state == ConnectionState.CONNECTED)
                callbacks.onStateChange(state)
                if (state == ConnectionState.DISCONNECTED && autoFallbackToRelay) {
                    connectRelay(config)
                }
            }
        }
    }

    private fun replaceTransport(
        next: GatewayTransport?,
        config: SessionGatewayConfig,
        connectionType: String,
        isConnected: Boolean,
    ) {
        val previous = activeTransport
        activeTransport = next
        currentSnapshot = SessionGatewaySnapshot(
            sessionId = config.sessionId,
            preferredConnectionMode = config.preferredConnectionMode,
            connectionType = connectionType,
            isConnected = isConnected,
        )
        callbacks.onConnectionTypeChange(connectionType)
        if (previous != null && previous !== next) {
            previous.disconnect()
        }
    }
}

internal class RelayGatewayTransport(
    private val client: RelayWebSocketClient,
) : GatewayTransport {
    override var onMessage: ((org.json.JSONObject) -> Unit)?
        get() = client.onMessage
        set(value) {
            client.onMessage = value
        }
    override var onBinaryMessage: ((org.json.JSONObject, ByteArray) -> Unit)?
        get() = client.onBinaryMessage
        set(value) {
            client.onBinaryMessage = value
        }
    override var onStateChange: ((ConnectionState) -> Unit)?
        get() = client.onStateChange
        set(value) {
            client.onStateChange = value
        }
    override var onError: ((String) -> Unit)?
        get() = client.onError
        set(value) {
            client.onError = value
        }
    override var onAck: ((RelayAck) -> Unit)?
        get() = client.onAck
        set(value) {
            client.onAck = value
        }
    override var onDeviceOnline: (() -> Unit)?
        get() = client.onDeviceOnline
        set(value) {
            client.onDeviceOnline = value
        }
    override var onDeviceOffline: (() -> Unit)?
        get() = client.onDeviceOffline
        set(value) {
            client.onDeviceOffline = value
        }
    override var onDeviceList: ((JSONArray) -> Unit)?
        get() = client.onDeviceList
        set(value) {
            client.onDeviceList = value
        }

    override val isConnected: Boolean
        get() = client.isConnected

    override fun connect() = client.connect()

    override fun disconnect() = client.disconnect()

    override fun reconnect() = client.reconnect()

    override fun send(envelope: org.json.JSONObject) = client.send(envelope)

    override fun sendBinary(header: org.json.JSONObject, payload: ByteArray) = client.sendBinary(header, payload)

    override fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState,
        retryAfterMs: Long?,
        reason: String?,
    ) = client.sendAck(messageId, source, sessionId, state, retryAfterMs, reason)
}

internal class LocalGatewayTransport(
    private val client: LocalRelayClient,
) : GatewayTransport {
    override var onMessage: ((org.json.JSONObject) -> Unit)?
        get() = client.onMessage
        set(value) {
            client.onMessage = value
        }
    override var onBinaryMessage: ((org.json.JSONObject, ByteArray) -> Unit)?
        get() = client.onBinaryMessage
        set(value) {
            client.onBinaryMessage = value
        }
    override var onStateChange: ((ConnectionState) -> Unit)?
        get() = client.onStateChange
        set(value) {
            client.onStateChange = value
        }
    override var onError: ((String) -> Unit)?
        get() = client.onError
        set(value) {
            client.onError = value
        }
    override var onAck: ((RelayAck) -> Unit)?
        get() = client.onAck
        set(value) {
            client.onAck = value
        }
    override var onDeviceOnline: (() -> Unit)? = null
    override var onDeviceOffline: (() -> Unit)? = null
    override var onDeviceList: ((JSONArray) -> Unit)? = null

    override val isConnected: Boolean
        get() = client.isConnected

    override fun connect() = client.connect()

    override fun disconnect() = client.disconnect()

    override fun reconnect() = client.reconnect()

    override fun send(envelope: org.json.JSONObject) = client.send(envelope)

    override fun sendBinary(header: org.json.JSONObject, payload: ByteArray) = client.sendBinary(header, payload)

    override fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState,
        retryAfterMs: Long?,
        reason: String?,
    ) = Unit
}

package sy.yuanio.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class DefaultSessionGatewayTest {

    @Test
    fun auto模式在无本地地址时应走relay() {
        val relay = FakeGatewayTransport()
        val gateway = DefaultSessionGateway(
            relayFactory = { _, _ -> relay },
            localFactory = { error("should not create local transport") },
        )

        gateway.bind(SessionGatewayCallbacks())
        gateway.connect(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token",
                sessionId = "session-a",
                preferredConnectionMode = ConnectionMode.AUTO,
                manualIp = "",
            )
        )

        assertSame(relay, gateway.transport)
        assertTrue(relay.connectCalled)
        assertEquals("relay", gateway.snapshot().connectionType)
        assertEquals("session-a", gateway.snapshot().sessionId)
    }

    @Test
    fun local模式在本地能力可用时应走local() {
        val local = FakeGatewayTransport()
        val gateway = DefaultSessionGateway(
            relayFactory = { _, _ -> error("should not create relay transport") },
            localFactory = { local },
        )

        gateway.bind(SessionGatewayCallbacks())
        gateway.connect(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token",
                sessionId = "session-a",
                preferredConnectionMode = ConnectionMode.LOCAL,
                manualIp = "192.168.1.20",
                manualPort = 9394,
                deviceId = "device-1",
                localAuthKeyBytes = byteArrayOf(1, 2, 3),
            )
        )

        assertSame(local, gateway.transport)
        assertTrue(local.connectCalled)
        assertEquals("local", gateway.snapshot().connectionType)
    }

    @Test
    fun auto模式下本地断开后应回退relay() {
        val local = FakeGatewayTransport()
        val relay = FakeGatewayTransport()
        val gateway = DefaultSessionGateway(
            relayFactory = { _, _ -> relay },
            localFactory = { local },
        )

        gateway.bind(SessionGatewayCallbacks())
        gateway.connect(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token",
                sessionId = "session-a",
                preferredConnectionMode = ConnectionMode.AUTO,
                manualIp = "192.168.1.20",
                manualPort = 9394,
                deviceId = "device-1",
                localAuthKeyBytes = byteArrayOf(1, 2, 3),
            )
        )

        local.emitState(ConnectionState.DISCONNECTED)

        assertSame(relay, gateway.transport)
        assertTrue(relay.connectCalled)
        assertEquals("relay", gateway.snapshot().connectionType)
    }

    @Test
    fun switchSession应切换到新session并重连() {
        val relayA = FakeGatewayTransport()
        val relayB = FakeGatewayTransport()
        var callCount = 0
        val gateway = DefaultSessionGateway(
            relayFactory = { _, _ -> if (callCount++ == 0) relayA else relayB },
            localFactory = { error("should not create local transport") },
        )

        gateway.bind(SessionGatewayCallbacks())
        gateway.connect(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token-a",
                sessionId = "session-a",
                preferredConnectionMode = ConnectionMode.RELAY,
            )
        )
        gateway.switchSession(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token-b",
                sessionId = "session-b",
                preferredConnectionMode = ConnectionMode.RELAY,
            )
        )

        assertTrue(relayA.disconnectCalled)
        assertSame(relayB, gateway.transport)
        assertTrue(relayB.connectCalled)
        assertEquals("session-b", gateway.snapshot().sessionId)
    }

    @Test
    fun relay模式默认使用WebSocket客户端() {
        val gateway = DefaultSessionGateway()

        gateway.bind(SessionGatewayCallbacks())
        gateway.connect(
            SessionGatewayConfig(
                serverUrl = "https://example.com",
                sessionToken = "token",
                sessionId = "session-a",
                preferredConnectionMode = ConnectionMode.RELAY,
            )
        )

        val transport = gateway.transport
        assertTrue(transport is RelayGatewayTransport)
        val field = RelayGatewayTransport::class.java.getDeclaredField("client")
        field.isAccessible = true
        val client = field.get(transport)
        assertTrue(client is RelayWebSocketClient)
    }
}

private class FakeGatewayTransport : GatewayTransport {
    override var onMessage: ((JSONObject) -> Unit)? = null
    override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)? = null
    override var onStateChange: ((ConnectionState) -> Unit)? = null
    override var onError: ((String) -> Unit)? = null
    override var onAck: ((RelayAck) -> Unit)? = null
    override var onDeviceOnline: (() -> Unit)? = null
    override var onDeviceOffline: (() -> Unit)? = null
    override var onDeviceList: ((JSONArray) -> Unit)? = null

    override var isConnected: Boolean = false
    var connectCalled: Boolean = false
    var disconnectCalled: Boolean = false
    var lastAckMessageId: String? = null

    override fun connect() {
        connectCalled = true
        isConnected = true
    }

    override fun disconnect() {
        disconnectCalled = true
        isConnected = false
    }

    override fun reconnect() {
        disconnect()
        connect()
    }

    override fun send(envelope: JSONObject) = Unit

    override fun sendBinary(header: JSONObject, payload: ByteArray) = Unit

    override fun sendAck(
        messageId: String,
        source: String,
        sessionId: String,
        state: RelayAckState,
        retryAfterMs: Long?,
        reason: String?,
    ) {
        lastAckMessageId = messageId
    }

    fun emitState(state: ConnectionState) {
        isConnected = state == ConnectionState.CONNECTED
        onStateChange?.invoke(state)
    }
}

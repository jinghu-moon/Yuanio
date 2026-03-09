package com.yuanio.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentCommandDispatchTest {

    @Test
    fun `createAgentCommandEnvelope 为空命令时返回 null`() {
        val envelope = createAgentCommandEnvelope(
            command = "  ",
            sharedKey = ByteArray(32) { 7 },
            deviceId = "android-device",
            sessionId = "session-1",
        )

        assertEquals(null, envelope)
    }

    @Test
    fun `buildAgentCommandEnvelopeInput 构造 prompt 输入`() {
        val sharedKey = ByteArray(32) { (it + 1).toByte() }

        val input = buildAgentCommandEnvelopeInput(
            command = "/tasks",
            sharedKey = sharedKey,
            deviceId = "android-device",
            sessionId = "session-1",
        )

        assertNotNull(input)
        input ?: return
        assertEquals("prompt", input.type)
        assertEquals("android-device", input.source)
        assertEquals("broadcast", input.target)
        assertEquals("session-1", input.sessionId)
        assertEquals("/tasks", input.plaintext)
        assertTrue(input.sharedKey.contentEquals(sharedKey))
    }

    @Test
    fun `sendAgentCommandEnvelope 使用已连接 transport 直接发送`() {
        val transport = FakeTransport(isConnected = true)
        val envelope = buildEnvelope("/tasks")

        val sent = sendAgentCommandEnvelope(transport, envelope)

        assertTrue(sent)
        assertEquals(1, transport.sentEnvelopes.size)
        assertTrue(transport.sentEnvelopes.first() === envelope)
    }

    @Test
    fun `connectAndSendAgentCommand 连接成功后发送并断开`() {
        val transport = FakeTransport(isConnected = false)
        val envelope = buildEnvelope("/approvals")

        val sent = connectAndSendAgentCommand(transport, envelope)

        assertTrue(sent)
        assertTrue(transport.connectCalled)
        assertTrue(transport.disconnectCalled)
        assertEquals(1, transport.sentEnvelopes.size)
        assertTrue(transport.sentEnvelopes.first() === envelope)
    }

    @Test
    fun `sendAgentCommandEnvelope send 抛错时返回 false`() {
        val transport = FakeTransport(isConnected = true, failOnSend = true)
        val envelope = buildEnvelope("/tasks")

        val sent = sendAgentCommandEnvelope(transport, envelope)

        assertFalse(sent)
        assertTrue(transport.sentEnvelopes.isEmpty())
    }

    private fun buildEnvelope(command: String): JSONObject {
        return JSONObject()
            .put("type", "prompt")
            .put("command", command)
    }

    private class FakeTransport(
        override val isConnected: Boolean,
        private val failOnSend: Boolean = false,
    ) : MessageTransport {
        val sentEnvelopes = mutableListOf<JSONObject>()
        var connectCalled = false
        var disconnectCalled = false

        override var onMessage: ((JSONObject) -> Unit)? = null
        override var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)? = null
        override var onStateChange: ((ConnectionState) -> Unit)? = null
        override var onError: ((String) -> Unit)? = null

        override fun connect() {
            connectCalled = true
            onStateChange?.invoke(ConnectionState.CONNECTED)
        }

        override fun disconnect() {
            disconnectCalled = true
        }

        override fun reconnect() = Unit

        override fun send(envelope: JSONObject) {
            if (failOnSend) error("boom")
            sentEnvelopes += envelope
        }

        override fun sendBinary(header: JSONObject, payload: ByteArray) = Unit
    }

    private companion object {
        val SHARED_KEY = ByteArray(32) { index -> (index + 11).toByte() }
    }
}

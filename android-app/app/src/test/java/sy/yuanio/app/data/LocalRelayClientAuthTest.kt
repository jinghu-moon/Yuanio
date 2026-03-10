package sy.yuanio.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class LocalRelayClientAuthTest {
    @Test
    fun `build auth url falls back to plain ws when auth data missing`() {
        val client = LocalRelayClient(
            host = "192.168.1.10",
            port = 9394,
        )

        assertEquals("ws://192.168.1.10:9394/ws", client.buildAuthUrl())
    }

    @Test
    fun `build auth url includes signed query when auth data present`() {
        val authKey = "local-auth-key".toByteArray()
        val deviceId = "dev_123"
        val nonce = "nonce-fixed-1234"
        val ts = 1_700_000_000_000L
        val expectedSig = LocalRelayClient.hmacSha256(authKey, "$deviceId$nonce$ts")
        val client = LocalRelayClient(
            host = "10.0.0.8",
            port = 9394,
            deviceId = deviceId,
            authKeyBytes = authKey,
            clock = { ts },
            nonceProvider = { nonce },
        )

        val url = client.buildAuthUrl()
        assertTrue(url.startsWith("ws://10.0.0.8:9394/ws?"))
        assertTrue(url.contains("deviceId=$deviceId"))
        assertTrue(url.contains("nonce=$nonce"))
        assertTrue(url.contains("ts=$ts"))
        assertTrue(url.contains("sig=$expectedSig"))
    }

    @Test
    fun `local connect timeout keeps auto fallback responsive`() {
        assertEquals(1800L, LocalRelayClient.CONNECT_TIMEOUT_MS)
    }

    @Test
    fun `extract ack message id from payload object`() {
        val env = JSONObject(
            """{"type":"ack","payload":{"messageId":"msg_1","receivedAt":1700000000000}}"""
        )
        assertEquals("msg_1", LocalRelayClient.extractAckMessageId(env))
    }

    @Test
    fun `extract ack message id from payload string`() {
        val env = JSONObject(
            """{"type":"ack","payload":"{\"messageId\":\"msg_2\"}"}"""
        )
        assertEquals("msg_2", LocalRelayClient.extractAckMessageId(env))
    }

    @Test
    fun `extract ack message id returns empty for non ack envelope`() {
        val env = JSONObject("""{"type":"stream_chunk","payload":"hello"}""")
        assertEquals("", LocalRelayClient.extractAckMessageId(env))
    }

    @Test
    fun `extract relay ack parses state and retryAfter`() {
        val env = JSONObject(
            """{"type":"ack","payload":{"messageId":"msg_retry","state":"retry_after","retryAfterMs":1500}}"""
        )
        val ack = extractRelayAckFromEnvelope(env)
        assertNotNull(ack)
        assertEquals("msg_retry", ack?.messageId)
        assertEquals(RelayAckState.RETRY_AFTER, ack?.state)
        assertEquals(1500L, ack?.retryAfterMs)
    }
}


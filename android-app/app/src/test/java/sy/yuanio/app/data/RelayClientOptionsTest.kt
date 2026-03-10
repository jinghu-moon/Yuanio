package sy.yuanio.app.data

import io.socket.engineio.client.transports.WebSocket
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Test

class RelayClientOptionsTest {
    @Test
    fun `build options uses websocket only`() {
        val opts = buildRelaySocketOptions("token", preferWebSocket = true)
        assertArrayEquals(arrayOf(WebSocket.NAME), opts.transports)
        assertFalse(opts.rememberUpgrade)
        assertFalse(opts.upgrade)
        assertEquals(300, opts.reconnectionDelay)
        assertEquals(5000, opts.reconnectionDelayMax)
        assertEquals(0.2, opts.randomizationFactor, 0.0001)
        assertEquals(5000, opts.timeout)
    }

    @Test
    fun `apply fallback is no-op for websocket only strategy`() {
        val opts = buildRelaySocketOptions("token", preferWebSocket = true)
        val changed = applyTransportFallback(opts)
        assertFalse(changed)
        assertFalse(opts.rememberUpgrade)
        assertArrayEquals(arrayOf(WebSocket.NAME), opts.transports)
    }

    @Test
    fun `apply fallback remains no-op when preferWebsocket disabled`() {
        val opts = buildRelaySocketOptions("token", preferWebSocket = false)
        val changed = applyTransportFallback(opts)
        assertFalse(changed)
        assertArrayEquals(arrayOf(WebSocket.NAME), opts.transports)
    }
}


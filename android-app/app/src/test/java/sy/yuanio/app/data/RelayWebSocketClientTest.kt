package sy.yuanio.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class RelayWebSocketClientTest {
    @Test
    fun `relay websocket client class should exist`() {
        Class.forName("sy.yuanio.app.data.RelayWebSocketClient")
    }

    @Test
    fun `build hello frame includes required fields`() {
        val clazz = Class.forName("sy.yuanio.app.data.RelayWebSocketClient")
        val method = clazz.getDeclaredMethod(
            "buildHelloFrame",
            String::class.java,
            String::class.java,
            String::class.java,
            String::class.java,
            String::class.java,
        )
        val frame = method.invoke(null, "token", "1.0.0", "default", "dev_1", "app") as JSONObject
        assertEquals("hello", frame.getString("type"))
        val data = frame.getJSONObject("data")
        assertEquals("token", data.getString("token"))
        assertEquals("1.0.0", data.getString("protocolVersion"))
        assertEquals("default", data.getString("namespace"))
        assertEquals("dev_1", data.getString("deviceId"))
        assertEquals("app", data.getString("role"))
    }
}

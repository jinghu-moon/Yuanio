package sy.yuanio.app.data

import org.json.JSONObject

/**
 * 传输层抽象接口，RelayClient 和 LocalRelayClient 共用。
 */
interface MessageTransport {
    val isConnected: Boolean
    fun connect()
    fun disconnect()
    fun reconnect()
    fun send(envelope: JSONObject)
    fun sendBinary(header: JSONObject, payload: ByteArray)

    var onMessage: ((JSONObject) -> Unit)?
    var onBinaryMessage: ((JSONObject, ByteArray) -> Unit)?
    var onStateChange: ((ConnectionState) -> Unit)?
    var onError: ((String) -> Unit)?
}


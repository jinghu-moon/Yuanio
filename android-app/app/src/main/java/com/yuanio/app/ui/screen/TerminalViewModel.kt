package com.yuanio.app.ui.screen

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.yuanio.app.R
import com.yuanio.app.data.EnvelopeHelper
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.RelayClient
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

class TerminalViewModel(app: Application) : AndroidViewModel(app) {

    data class TerminalOutput(val ptyId: String, val data: String)
    data class TerminalStatus(val connected: Boolean, val exited: Boolean)
    data class TerminalMetrics(
        val pid: Int?,
        val startedAt: Long,
        val lastActiveAt: Long,
        val cols: Int,
        val rows: Int,
        val bufferedBytes: Int,
        val paused: Boolean,
    )

    private val keyStore = KeyStore(app)
    private var relay: RelayClient? = null
    private var relaySessionId: String? = null
    private var relaySessionToken: String? = null
    private var relayServerUrl: String? = null
    private val spawned = mutableSetOf<String>()
    private val pendingConnects = mutableMapOf<String, PendingConnect>()

    data class PendingConnect(
        val cols: Int,
        val rows: Int,
        val shell: String?,
        val cwd: String?,
    )

    private val _status = MutableStateFlow<Map<String, TerminalStatus>>(emptyMap())
    val status = _status.asStateFlow()

    private val _metrics = MutableStateFlow<Map<String, TerminalMetrics>>(emptyMap())
    val metrics = _metrics.asStateFlow()

    private val _relayState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val relayState = _relayState.asStateFlow()

    private val _relayError = MutableStateFlow<String?>(null)
    val relayError = _relayError.asStateFlow()

    private val _outputChannel = Channel<TerminalOutput>(
        capacity = 8192,
        onBufferOverflow = BufferOverflow.SUSPEND,
    )
    val outputs: Flow<TerminalOutput> = _outputChannel.receiveAsFlow()

    private fun s(id: Int, vararg args: Any): String =
        getApplication<Application>().getString(id, *args)

    fun connect(ptyId: String, cols: Int, rows: Int, shell: String?, cwd: String?) {
        if (!ensureRelayConnected()) return
        pendingConnects[ptyId] = PendingConnect(cols, rows, shell, cwd)
        flushPendingConnect(ptyId)
    }

    private fun ensureRelayConnected(): Boolean {
        val url = keyStore.serverUrl
        val token = keyStore.sessionToken
        val sessionId = keyStore.sessionId
        if (url.isNullOrBlank() || token.isNullOrBlank() || sessionId.isNullOrBlank()) {
            _relayState.value = ConnectionState.DISCONNECTED
            _relayError.value = s(R.string.terminal_error_missing_session)
            return false
        }
        val needsReconnect = relay == null
            || relaySessionToken != token
            || relaySessionId != sessionId
            || relayServerUrl != url

        if (!needsReconnect) {
            if (relay?.isConnected != true) relay?.reconnect()
            return true
        }

        relay?.disconnect()
        relay = RelayClient(url, token).apply {
            onMessage = { handleEnvelope(it) }
            onBinaryMessage = { env, payload -> handleBinaryEnvelope(env, payload) }
            onStateChange = { state ->
                _relayState.value = state
                if (state == ConnectionState.CONNECTED) {
                    _relayError.value = null
                    flushAllPendingConnects()
                    val next = _status.value.mapValues { (ptyId, s) ->
                        if (s.exited) s else s.copy(connected = spawned.contains(ptyId))
                    }
                    _status.value = next
                }
                if (state == ConnectionState.DISCONNECTED) {
                    val next = _status.value.mapValues { (_, s) ->
                        s.copy(connected = false)
                    }
                    _status.value = next
                }
            }
            onError = { msg ->
                _relayError.value = msg
                val lowered = msg.lowercase()
                val authFailed = lowered.contains("401")
                    || lowered.contains("unauthorized")
                    || lowered.contains("forbidden")
                    || lowered.contains("token")
                    || lowered.contains("auth")
                if (authFailed) {
                    // 鉴权失败直接断开，避免 Socket.IO 自动无限重连造成“重连中”假象。
                    relay?.disconnect()
                    _relayState.value = ConnectionState.DISCONNECTED
                    _relayError.value = s(R.string.terminal_error_auth_failed)
                }
            }
            connect()
        }
        relaySessionToken = token
        relaySessionId = sessionId
        relayServerUrl = url
        spawned.clear()
        return true
    }

    private fun flushAllPendingConnects() {
        val ids = pendingConnects.keys.toList()
        for (id in ids) {
            flushPendingConnect(id)
        }
    }

    private fun flushPendingConnect(ptyId: String) {
        val pending = pendingConnects[ptyId] ?: return
        if (relay?.isConnected != true) {
            setStatus(ptyId, connected = false, exited = false)
            return
        }

        if (spawned.add(ptyId)) {
            val payload = JSONObject()
                .put("cols", pending.cols)
                .put("rows", pending.rows)
            if (!pending.shell.isNullOrBlank()) payload.put("shell", pending.shell)
            if (!pending.cwd.isNullOrBlank()) payload.put("cwd", pending.cwd)
            if (!sendBinaryEnvelope(ptyId, "pty_spawn", payload.toString())) return
        } else {
            if (!sendBinaryEnvelope(ptyId, "pty_resize", JSONObject()
                .put("cols", pending.cols).put("rows", pending.rows).toString())) return
        }

        setStatus(ptyId, connected = true, exited = false)
    }

    private fun handleEnvelope(env: JSONObject) {
        // 非 PTY 消息走 Base64 解码（兼容旧路径）
        val key = keyStore.sharedKey ?: return
        when (env.optString("type")) {
            "pty_output" -> {
                val ptyId = env.optString("ptyId")
                if (ptyId.isNotBlank()) {
                    try {
                        val data = EnvelopeHelper.decryptPayload(env, key)
                        _outputChannel.trySend(TerminalOutput(ptyId, data))
                    } catch (e: Exception) {
                        _relayError.value = s(
                            R.string.terminal_error_decrypt_output,
                            e.message ?: s(R.string.common_unknown),
                        )
                    }
                }
            }
            "pty_status" -> {
                val ptyId = env.optString("ptyId")
                if (ptyId.isNotBlank()) {
                    try {
                        val data = EnvelopeHelper.decryptPayload(env, key)
                        val obj = JSONObject(data)
                        setMetrics(
                            ptyId = ptyId,
                            metrics = TerminalMetrics(
                                pid = if (obj.has("pid")) obj.optInt("pid") else null,
                                startedAt = obj.optLong("startedAt"),
                                lastActiveAt = obj.optLong("lastActiveAt"),
                                cols = obj.optInt("cols"),
                                rows = obj.optInt("rows"),
                                bufferedBytes = obj.optInt("bufferedBytes"),
                                paused = obj.optBoolean("paused")
                            )
                        )
                    } catch (e: Exception) {
                        _relayError.value = s(
                            R.string.terminal_error_decrypt_status,
                            e.message ?: s(R.string.common_unknown),
                        )
                    }
                }
            }
            "pty_exit" -> {
                val ptyId = env.optString("ptyId")
                if (ptyId.isNotBlank()) {
                    spawned.remove(ptyId)
                    setStatus(ptyId, connected = false, exited = true)
                    clearMetrics(ptyId)
                }
            }
        }
    }

    private fun handleBinaryEnvelope(env: JSONObject, payload: ByteArray) {
        val key = keyStore.sharedKey ?: return
        when (env.optString("type")) {
            "pty_output" -> {
                val ptyId = env.optString("ptyId")
                if (ptyId.isNotBlank()) {
                    try {
                        val data = EnvelopeHelper.decryptBinaryPayload(env, payload, key)
                        _outputChannel.trySend(TerminalOutput(ptyId, data))
                    } catch (e: Exception) {
                        _relayError.value = s(
                            R.string.terminal_error_decrypt_binary,
                            e.message ?: s(R.string.common_unknown),
                        )
                    }
                }
            }
            "pty_exit" -> {
                val ptyId = env.optString("ptyId")
                if (ptyId.isNotBlank()) {
                    spawned.remove(ptyId)
                    setStatus(ptyId, connected = false, exited = true)
                    clearMetrics(ptyId)
                }
            }
        }
    }

    fun sendInput(ptyId: String, data: String) {
        sendBinaryEnvelope(ptyId, "pty_input", data)
    }

    fun sendResize(ptyId: String, cols: Int, rows: Int) {
        val prev = pendingConnects[ptyId]
        pendingConnects[ptyId] = PendingConnect(
            cols = cols,
            rows = rows,
            shell = prev?.shell,
            cwd = prev?.cwd,
        )
        sendBinaryEnvelope(ptyId, "pty_resize", JSONObject()
            .put("cols", cols).put("rows", rows).toString())
    }

    fun kill(ptyId: String) {
        sendBinaryEnvelope(ptyId, "pty_kill", "")
        spawned.remove(ptyId)
        pendingConnects.remove(ptyId)
        setStatus(ptyId, connected = false, exited = true)
        clearMetrics(ptyId)
    }

    fun killAll() {
        val ids = spawned.toList()
        for (id in ids) {
            sendBinaryEnvelope(id, "pty_kill", "")
        }
        spawned.clear()
        pendingConnects.clear()
        _status.value = emptyMap()
        _metrics.value = emptyMap()
    }

    private fun sendBinaryEnvelope(ptyId: String, type: String, plaintext: String): Boolean {
        if (!ensureRelayConnected()) return false
        val key = keyStore.sharedKey ?: return false
        val deviceId = keyStore.deviceId ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val activeRelay = relay ?: return false
        if (!activeRelay.isConnected) {
            activeRelay.reconnect()
            return false
        }
        val (header, payload) = EnvelopeHelper.createBinary(
            source = deviceId, target = "broadcast",
            sessionId = sessionId, type = type,
            plaintext = plaintext, sharedKey = key,
            ptyId = ptyId
        )
        activeRelay.sendBinary(header, payload)
        return true
    }

    override fun onCleared() {
        killAll()
        relay?.disconnect()
    }

    fun reconnect() {
        if (!ensureRelayConnected()) return
        relay?.reconnect()
    }

    private fun setStatus(ptyId: String, connected: Boolean, exited: Boolean) {
        val next = _status.value.toMutableMap()
        next[ptyId] = TerminalStatus(connected, exited)
        _status.value = next
    }

    private fun setMetrics(ptyId: String, metrics: TerminalMetrics) {
        val next = _metrics.value.toMutableMap()
        next[ptyId] = metrics
        _metrics.value = next
    }

    private fun clearMetrics(ptyId: String) {
        val next = _metrics.value.toMutableMap()
        if (next.remove(ptyId) != null) _metrics.value = next
    }
}

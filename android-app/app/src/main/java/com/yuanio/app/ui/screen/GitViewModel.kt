package com.yuanio.app.ui.screen

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.yuanio.app.data.EnvelopeHelper
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.RelayClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

// region Data classes

data class GitStatus(
    val branch: String = "",
    val staged: List<String> = emptyList(),
    val modified: List<String> = emptyList(),
    val untracked: List<String> = emptyList()
)

data class GitCommit(
    val hash: String,
    val author: String,
    val date: String,
    val message: String
)

data class GitBranch(
    val name: String,
    val isRemote: Boolean
)

data class GitBranchInfo(
    val current: String = "",
    val branches: List<GitBranch> = emptyList()
)

data class DiffNumstat(
    val file: String,
    val added: Int = 0,
    val deleted: Int = 0
)

// endregion

class GitViewModel(app: Application) : AndroidViewModel(app) {

    private val keyStore = KeyStore(app)
    private var relay: RelayClient? = null
    private var relaySessionId: String? = null
    private var relaySessionToken: String? = null
    private var relayServerUrl: String? = null
    private val pendingRpc = mutableMapOf<String, (JSONObject) -> Unit>()

    private val _status = MutableStateFlow(GitStatus())
    val status = _status.asStateFlow()

    private val _log = MutableStateFlow<List<GitCommit>>(emptyList())
    val log = _log.asStateFlow()

    private val _branchInfo = MutableStateFlow(GitBranchInfo())
    val branchInfo = _branchInfo.asStateFlow()

    private val _selectedDiff = MutableStateFlow<Pair<String, String>?>(null)
    val selectedDiff = _selectedDiff.asStateFlow()

    private val _diffNumstat = MutableStateFlow<List<DiffNumstat>>(emptyList())
    val diffNumstat = _diffNumstat.asStateFlow()

    private val _stagedDiff = MutableStateFlow("")
    val stagedDiff = _stagedDiff.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    fun connect() {
        if (!ensureRelayConnected()) return
        fetchStatus()
    }

    private fun handleEnvelope(env: JSONObject) {
        val key = keyStore.sharedKey ?: return
        if (env.optString("type") != "rpc_resp") return
        val payload = EnvelopeHelper.decryptPayload(env, key)
        val obj = JSONObject(payload)
        val id = obj.optString("id")
        pendingRpc.remove(id)?.invoke(obj)
    }

    private suspend fun rpcCall(method: String, params: Map<String, Any> = emptyMap()): JSONObject? {
        if (!ensureRelayConnected()) return null
        val activeRelay = relay ?: return null
        if (!waitForRelayConnected(activeRelay)) return null

        val key = keyStore.sharedKey ?: return null
        val deviceId = keyStore.deviceId ?: return null
        val sessionId = keyStore.sessionId ?: return null
        val rpcId = java.util.UUID.randomUUID().toString().take(8)

        val payload = JSONObject().put("id", rpcId)
            .put("method", method)
            .put("params", JSONObject(params))
            .toString()

        return withTimeoutOrNull(10_000) {
            suspendCancellableCoroutine { cont ->
                pendingRpc[rpcId] = { cont.resume(it) }
                cont.invokeOnCancellation { pendingRpc.remove(rpcId) }
                activeRelay.send(EnvelopeHelper.create(
                    source = deviceId, target = "broadcast",
                    sessionId = sessionId, type = "rpc_req",
                    plaintext = payload, sharedKey = key
                ))
            }
        }
    }

    private fun ensureRelayConnected(): Boolean {
        val url = keyStore.serverUrl ?: return false
        val token = keyStore.sessionToken ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val needsReconnect = relay == null
            || relaySessionToken != token
            || relaySessionId != sessionId
            || relayServerUrl != url

        if (needsReconnect) {
            relay?.disconnect()
            pendingRpc.clear()
            relay = RelayClient(url, token).apply {
                onMessage = { handleEnvelope(it) }
                connect()
            }
            relaySessionToken = token
            relaySessionId = sessionId
            relayServerUrl = url
        } else if (relay?.isConnected != true) {
            relay?.reconnect()
        }

        return true
    }

    private suspend fun waitForRelayConnected(client: RelayClient, timeoutMs: Long = 5000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!client.isConnected && System.currentTimeMillis() < deadline) {
            delay(100)
        }
        return client.isConnected
    }

    fun fetchStatus() {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val resp = rpcCall("git_status")
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val result = resp?.optJSONObject("result")
                if (result != null) {
                    _status.value = GitStatus(
                        branch = result.optString("branch", ""),
                        staged = result.jsonArrayToList("staged"),
                        modified = result.jsonArrayToList("modified"),
                        untracked = result.jsonArrayToList("untracked")
                    )
                }
            }
            _loading.value = false
        }
    }

    fun fetchLog(limit: Int = 20) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val resp = rpcCall("git_log", mapOf("limit" to limit))
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val arr = resp?.optJSONObject("result")?.optJSONArray("commits")
                val list = mutableListOf<GitCommit>()
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        list.add(GitCommit(
                            hash = o.optString("hash", ""),
                            author = o.optString("author", ""),
                            date = o.optString("date", ""),
                            message = o.optString("message", "")
                        ))
                    }
                }
                _log.value = list
            }
            _loading.value = false
        }
    }

    fun fetchDiff(file: String) {
        viewModelScope.launch {
            _loading.value = true
            val resp = rpcCall("git_diff", mapOf("file" to file))
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val diff = resp?.optJSONObject("result")?.optString("diff", "") ?: ""
                _selectedDiff.value = file to diff
            }
            _loading.value = false
        }
    }

    fun fetchBranches() {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val resp = rpcCall("git_branch")
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val result = resp?.optJSONObject("result")
                if (result != null) {
                    val current = result.optString("current", "")
                    val arr = result.optJSONArray("branches")
                    val list = mutableListOf<GitBranch>()
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            list.add(GitBranch(
                                name = o.optString("name", ""),
                                isRemote = o.optBoolean("isRemote", false)
                            ))
                        }
                    }
                    _branchInfo.value = GitBranchInfo(current, list)
                }
            }
            _loading.value = false
        }
    }

    /** Phase 11: 文件级变更统计 */
    fun fetchDiffNumstat() {
        viewModelScope.launch {
            _loading.value = true
            val resp = rpcCall("git_diff_numstat")
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val arr = resp?.optJSONObject("result")?.optJSONArray("files")
                val list = mutableListOf<DiffNumstat>()
                if (arr != null) for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(DiffNumstat(
                        file = o.optString("file"),
                        added = o.optInt("added"),
                        deleted = o.optInt("deleted")
                    ))
                }
                _diffNumstat.value = list
            }
            _loading.value = false
        }
    }

    /** Phase 11: 暂存区 diff */
    fun fetchStagedDiff() {
        viewModelScope.launch {
            _loading.value = true
            val resp = rpcCall("git_diff_staged")
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                val diff = resp?.optJSONObject("result")?.optString("diff", "") ?: ""
                _stagedDiff.value = diff
            }
            _loading.value = false
        }
    }

    fun closeDiff() { _selectedDiff.value = null }
    fun clearError() { _error.value = null }

    override fun onCleared() {
        relay?.disconnect()
    }
}

private fun JSONObject.jsonArrayToList(key: String): List<String> {
    val arr = optJSONArray(key) ?: return emptyList()
    return (0 until arr.length()).map { arr.getString(it) }
}

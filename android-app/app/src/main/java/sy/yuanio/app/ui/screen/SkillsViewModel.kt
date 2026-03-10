package sy.yuanio.app.ui.screen

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import sy.yuanio.app.R
import sy.yuanio.app.data.EnvelopeHelper
import sy.yuanio.app.data.KeyStore
import sy.yuanio.app.data.RelayClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

data class SkillItem(
    val id: String,
    val name: String,
    val description: String,
    val path: String,
    val scope: String,
    val source: String,
    val context: String,
    val userInvocable: Boolean,
)

data class SkillCandidate(
    val id: String,
    val name: String,
    val description: String,
    val path: String,
    val scope: String,
    val valid: Boolean,
    val warnings: List<String>,
)

data class SkillsLogItem(
    val at: Long,
    val level: String,
    val message: String,
)

data class SkillInstallSummary(
    val installId: String,
    val total: Int,
    val installed: Int,
    val skipped: Int,
    val failed: Int,
)

class SkillsViewModel(app: Application) : AndroidViewModel(app) {

    private val keyStore = KeyStore(app)
    private var relay: RelayClient? = null
    private var relaySessionId: String? = null
    private var relaySessionToken: String? = null
    private var relayServerUrl: String? = null
    private val pendingRpc = mutableMapOf<String, (JSONObject) -> Unit>()

    private val _skills = MutableStateFlow<List<SkillItem>>(emptyList())
    val skills = _skills.asStateFlow()

    private val _candidates = MutableStateFlow<List<SkillCandidate>>(emptyList())
    val candidates = _candidates.asStateFlow()

    private val _selectedCandidateIds = MutableStateFlow<Set<String>>(emptySet())
    val selectedCandidateIds = _selectedCandidateIds.asStateFlow()

    private val _installId = MutableStateFlow<String?>(null)
    val installId = _installId.asStateFlow()

    private val _summary = MutableStateFlow<SkillInstallSummary?>(null)
    val summary = _summary.asStateFlow()

    private val _logs = MutableStateFlow<List<SkillsLogItem>>(emptyList())
    val logs = _logs.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private fun s(id: Int, vararg args: Any): String =
        getApplication<Application>().getString(id, *args)

    fun connect() {
        if (!ensureRelayConnected()) return
        refreshSkills()
    }

    fun clearError() {
        _error.value = null
    }

    fun toggleCandidateSelection(id: String, checked: Boolean) {
        val prev = _selectedCandidateIds.value.toMutableSet()
        if (checked) prev.add(id) else prev.remove(id)
        _selectedCandidateIds.value = prev
    }

    fun selectAllValidCandidates() {
        _selectedCandidateIds.value = _candidates.value.filter { it.valid }.map { it.id }.toSet()
    }

    fun clearSelectedCandidates() {
        _selectedCandidateIds.value = emptySet()
    }

    fun refreshSkills(scope: String = "project") {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                val resp = rpcCall("list_skills")
                when {
                    resp == null -> _error.value = s(R.string.skills_error_agent_offline)
                    resp.has("error") -> _error.value = resp.optString("error", s(R.string.skills_error_list_failed))
                    else -> {
                        val arr = resp.optJSONArray("result")
                        val list = mutableListOf<SkillItem>()
                        if (arr != null) {
                            for (i in 0 until arr.length()) {
                                val item = arr.getJSONObject(i)
                                val itemScope = item.optString("scope", "project")
                                if (scope != "all" && itemScope != scope) continue
                                list.add(
                                    SkillItem(
                                        id = item.optString("id", ""),
                                        name = item.optString("name", "unknown"),
                                        description = item.optString("description", "(no description)"),
                                        path = item.optString("path", ""),
                                        scope = itemScope,
                                        source = item.optString("source", ""),
                                        context = item.optString("context", ""),
                                        userInvocable = item.optBoolean("userInvocable", true),
                                    )
                                )
                            }
                        }
                        _skills.value = list.sortedBy { it.name.lowercase() }
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    fun prepareInstall(source: String, scope: String = "project") {
        val normalizedSource = source.trim()
        if (normalizedSource.isBlank()) {
            _error.value = s(R.string.skills_error_source_required)
            return
        }
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                val resp = rpcCall(
                    "skill_install_prepare",
                    mapOf("source" to normalizedSource, "scope" to if (scope == "user") "user" else "project")
                )
                when {
                    resp == null -> _error.value = s(R.string.skills_error_prepare_no_response)
                    resp.has("error") -> _error.value = resp.optString("error", s(R.string.skills_error_prepare_failed))
                    else -> {
                        val result = resp.optJSONObject("result")
                        val installId = result?.optString("installId", "")?.trim().orEmpty()
                        val arr = result?.optJSONArray("candidates")
                        val list = mutableListOf<SkillCandidate>()
                        if (arr != null) {
                            for (i in 0 until arr.length()) {
                                val item = arr.getJSONObject(i)
                                val warningsArray = item.optJSONArray("warnings")
                                val warnings = mutableListOf<String>()
                                if (warningsArray != null) {
                                    for (j in 0 until warningsArray.length()) warnings.add(warningsArray.optString(j))
                                }
                                list.add(
                                    SkillCandidate(
                                        id = item.optString("id", "candidate_${i + 1}"),
                                        name = item.optString("name", "unknown"),
                                        description = item.optString("description", "(no description)"),
                                        path = item.optString("path", ""),
                                        scope = item.optString("scope", scope),
                                        valid = item.optBoolean("valid", true),
                                        warnings = warnings,
                                    )
                                )
                            }
                        }
                        _installId.value = installId.ifBlank { null }
                        _candidates.value = list
                        _selectedCandidateIds.value = list.filter { it.valid }.map { it.id }.toSet()
                        _summary.value = null
                        appendLog(
                            "info",
                            s(
                                R.string.skills_log_prepare_done,
                                installId.ifBlank { s(R.string.common_unknown) },
                                list.size,
                            )
                        )
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    fun loadInstallStatus() {
        val id = _installId.value?.trim().orEmpty()
        if (id.isBlank()) {
            _error.value = s(R.string.skills_error_install_id_empty)
            return
        }
        viewModelScope.launch {
            _loading.value = true
            try {
                val resp = rpcCall("skill_install_status", mapOf("installId" to id))
                when {
                    resp == null -> _error.value = s(R.string.skills_error_status_no_response)
                    resp.has("error") -> _error.value = resp.optString("error", s(R.string.skills_error_status_failed))
                    else -> {
                        val result = resp.optJSONObject("result")
                        val arr = result?.optJSONArray("candidates")
                        if (arr != null) {
                            val list = mutableListOf<SkillCandidate>()
                            for (i in 0 until arr.length()) {
                                val item = arr.getJSONObject(i)
                                val warningsArray = item.optJSONArray("warnings")
                                val warnings = mutableListOf<String>()
                                if (warningsArray != null) {
                                    for (j in 0 until warningsArray.length()) warnings.add(warningsArray.optString(j))
                                }
                                list.add(
                                    SkillCandidate(
                                        id = item.optString("id", "candidate_${i + 1}"),
                                        name = item.optString("name", "unknown"),
                                        description = item.optString("description", "(no description)"),
                                        path = item.optString("path", ""),
                                        scope = item.optString("scope", "project"),
                                        valid = item.optBoolean("valid", true),
                                        warnings = warnings,
                                    )
                                )
                            }
                            _candidates.value = list
                        }
                        appendLog("info", s(R.string.skills_log_status_refreshed, id))
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    fun commitSelected(conflictPolicy: String = "skip") {
        val id = _installId.value?.trim().orEmpty()
        if (id.isBlank()) {
            _error.value = s(R.string.skills_error_prepare_first)
            return
        }
        val selected = _selectedCandidateIds.value.toList()
        if (selected.isEmpty()) {
            _error.value = s(R.string.skills_error_select_candidate)
            return
        }

        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                val policy = when (conflictPolicy) {
                    "overwrite", "rename", "skip" -> conflictPolicy
                    else -> "skip"
                }
                val resp = rpcCall(
                    "skill_install_commit",
                    mapOf(
                        "installId" to id,
                        "selected" to selected,
                        "conflictPolicy" to policy,
                    )
                )
                when {
                    resp == null -> _error.value = s(R.string.skills_error_commit_no_response)
                    resp.has("error") -> _error.value = resp.optString("error", s(R.string.skills_error_commit_failed))
                    else -> {
                        val result = resp.optJSONObject("result")
                        val installed = result?.optJSONArray("installed")?.length() ?: 0
                        val skipped = result?.optJSONArray("skipped")?.length() ?: 0
                        val failed = result?.optJSONArray("failed")?.length() ?: 0
                        val total = result?.optInt("total", installed + skipped + failed) ?: 0
                        _summary.value = SkillInstallSummary(
                            installId = id,
                            total = total,
                            installed = installed,
                            skipped = skipped,
                            failed = failed,
                        )
                        appendLog(
                            "info",
                            s(R.string.skills_log_commit_done, id, total, installed, skipped, failed)
                        )
                        refreshSkills()
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    fun cancelInstall() {
        val id = _installId.value?.trim().orEmpty()
        if (id.isBlank()) {
            _error.value = s(R.string.skills_error_install_id_empty)
            return
        }
        viewModelScope.launch {
            _loading.value = true
            try {
                val resp = rpcCall("skill_install_cancel", mapOf("installId" to id))
                when {
                    resp == null -> _error.value = s(R.string.skills_error_cancel_no_response)
                    resp.has("error") -> _error.value = resp.optString("error", s(R.string.skills_error_cancel_failed))
                    else -> {
                        _installId.value = null
                        _candidates.value = emptyList()
                        _selectedCandidateIds.value = emptySet()
                        _summary.value = null
                        appendLog("warn", s(R.string.skills_log_install_canceled, id))
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    private fun appendLog(level: String, message: String) {
        val next = listOf(SkillsLogItem(System.currentTimeMillis(), level, message)) + _logs.value
        _logs.value = if (next.size > 120) next.take(120) else next
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

        val payload = JSONObject()
            .put("id", rpcId)
            .put("method", method)
            .put("params", JSONObject(params))
            .toString()

        return withTimeoutOrNull(12_000) {
            suspendCancellableCoroutine { cont ->
                pendingRpc[rpcId] = { cont.resume(it) }
                cont.invokeOnCancellation { pendingRpc.remove(rpcId) }
                activeRelay.send(
                    EnvelopeHelper.create(
                        source = deviceId,
                        target = "broadcast",
                        sessionId = sessionId,
                        type = "rpc_req",
                        plaintext = payload,
                        sharedKey = key
                    )
                )
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

    override fun onCleared() {
        relay?.disconnect()
        pendingRpc.clear()
    }
}


package com.yuanio.app.ui.screen

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.yuanio.app.R
import com.yuanio.app.data.EnvelopeHelper
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.RelayClient
import com.yuanio.app.data.UriFileUtils
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class FileEntry(
    val name: String,
    val isDir: Boolean,
    val sizeBytes: Long? = null,
    val modifiedAtMs: Long? = null,
    val fileCount: Int? = null,
    val totalSizeBytes: Long? = null,
    val summaryPartial: Boolean = false,
)

data class UploadState(
    val active: Boolean = false,
    val fileName: String = "",
    val uploadId: String? = null,
    val sentBytes: Long = 0L,
    val totalBytes: Long? = null,
    val status: String = "",
)

data class UploadCommitResult(
    val path: String,
    val atPath: String?,
    val promptRef: String?,
    val suggestedPrompt: String?,
    val cleanupScheduledMs: Long?,
)

data class DirectoryEntry(
    val name: String,
    val path: String,
)

data class DirectoryBrowserState(
    val cwd: String = ".",
    val parent: String? = null,
    val roots: List<String> = emptyList(),
    val entries: List<DirectoryEntry> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

data class DownloadedArtifact(
    val remotePath: String,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val uri: Uri,
)

data class OcrState(
    val running: Boolean = false,
    val text: String = "",
    val error: String? = null,
)

enum class FileAgentAction {
    SUMMARIZE,
    REVIEW,
    TESTS;

    fun buildPrompt(filePath: String): String = when (this) {
        SUMMARIZE -> "请阅读工作区文件 `$filePath` 并输出重点摘要、关键风险与下一步建议。"
        REVIEW -> "请对工作区文件 `$filePath` 做代码审查，优先指出 bug、回归风险与缺失测试。"
        TESTS -> "请基于工作区文件 `$filePath` 生成可直接运行的测试代码，并解释覆盖范围。"
    }
}

class FileManagerViewModel(app: Application) : AndroidViewModel(app) {

    private val keyStore = KeyStore(app)
    private val uploadResumePrefs =
        app.getSharedPreferences(UPLOAD_RESUME_PREFS, Context.MODE_PRIVATE)
    private var relay: RelayClient? = null
    private var relaySessionId: String? = null
    private var relaySessionToken: String? = null
    private var relayServerUrl: String? = null

    private val _path = MutableStateFlow(".")
    val path = _path.asStateFlow()

    private val _entries = MutableStateFlow<List<FileEntry>>(emptyList())
    val entries = _entries.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _fileContent = MutableStateFlow<String?>(null)
    val fileContent = _fileContent.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private val _uploadState = MutableStateFlow(UploadState())
    val uploadState = _uploadState.asStateFlow()

    private val _downloadedArtifact = MutableStateFlow<DownloadedArtifact?>(null)
    val downloadedArtifact = _downloadedArtifact.asStateFlow()

    private val _lastUploadedPath = MutableStateFlow<String?>(null)
    val lastUploadedPath = _lastUploadedPath.asStateFlow()

    private val _ocrState = MutableStateFlow(OcrState())
    val ocrState = _ocrState.asStateFlow()

    private val _directoryBrowser = MutableStateFlow(DirectoryBrowserState())
    val directoryBrowser = _directoryBrowser.asStateFlow()

    private fun s(id: Int, vararg args: Any): String =
        getApplication<Application>().getString(id, *args)

    // 本地上传指纹 -> uploadId，持久化用于重启后续传
    private val uploadResumeMap = loadUploadResumeMap()

    // RPC 回调注册
    private val pendingRpc = mutableMapOf<String, (JSONObject) -> Unit>()

    fun connect() {
        if (!ensureRelayConnected()) return
        ls(_path.value.ifBlank { "." })
        refreshDirectoryBrowser(_path.value.ifBlank { "." })
    }

    private fun handleEnvelope(env: JSONObject) {
        val key = keyStore.sharedKey ?: return
        if (env.optString("type") != "rpc_resp") return
        val payload = EnvelopeHelper.decryptPayload(env, key)
        val obj = JSONObject(payload)
        val id = obj.optString("id")
        pendingRpc.remove(id)?.invoke(obj)
    }

    private suspend fun rpcCall(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeoutMs: Long = RPC_TIMEOUT_MS,
    ): JSONObject? {
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

        return withTimeoutOrNull(timeoutMs) {
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

    private suspend fun rpcCallWithRetry(
        method: String,
        params: Map<String, Any> = emptyMap(),
        noResponseError: String,
        timeoutMs: Long = UPLOAD_RPC_TIMEOUT_MS,
        maxAttempts: Int = UPLOAD_RPC_MAX_ATTEMPTS,
    ): JSONObject {
        var attempt = 0
        var lastError: String = noResponseError
        while (attempt < maxAttempts) {
            val resp = rpcCall(method, params, timeoutMs)
            if (resp == null) {
                lastError = noResponseError
            } else if (resp.has("error")) {
                lastError = resp.optString("error").ifBlank { s(R.string.common_unknown) }
            } else {
                return resp
            }
            if (attempt < maxAttempts - 1) {
                delay(retryDelayMs(attempt))
            }
            attempt += 1
        }
        throw IllegalStateException(lastError)
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

    fun ls(dir: String) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                val resp = rpcCall("ls", mapOf("path" to dir))
                when {
                    resp == null -> {
                        _error.value = s(R.string.file_manager_error_fetch_dir)
                        _entries.value = emptyList()
                    }
                    resp.has("error") -> {
                        _error.value = resp.getString("error")
                    }
                    else -> {
                        _path.value = dir
                        val arr = resp.optJSONArray("result")
                        if (arr == null) {
                            _entries.value = emptyList()
                        } else {
                            val list = mutableListOf<FileEntry>()
                            for (i in 0 until arr.length()) {
                                val o = arr.getJSONObject(i)
                                list.add(
                                    FileEntry(
                                        name = o.getString("name"),
                                        isDir = o.getBoolean("isDir"),
                                        sizeBytes = o.optNullableLong("sizeBytes"),
                                        modifiedAtMs = o.optNullableLong("modifiedAtMs"),
                                        fileCount = o.optNullableInt("fileCount"),
                                        totalSizeBytes = o.optNullableLong("totalSizeBytes"),
                                        summaryPartial = o.optNullableBoolean("summaryPartial") ?: false
                                    )
                                )
                            }
                            _entries.value = list.sortedWith(compareByDescending<FileEntry> { it.isDir }.thenBy { it.name })
                        }
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    fun refreshDirectoryBrowser(path: String = _path.value.ifBlank { "." }) {
        viewModelScope.launch {
            val current = _directoryBrowser.value
            _directoryBrowser.value = current.copy(loading = true, error = null)
            val resp = rpcCall("list_dirs", mapOf("path" to path))
            when {
                resp == null -> {
                    _directoryBrowser.value = current.copy(
                        loading = false,
                        error = s(R.string.file_manager_error_fetch_browser)
                    )
                }
                resp.has("error") -> {
                    _directoryBrowser.value = current.copy(
                        loading = false,
                        error = resp.optString("error", s(R.string.file_manager_error_list_dirs_failed))
                    )
                }
                else -> {
                    _directoryBrowser.value = parseDirectoryBrowserState(resp).copy(loading = false, error = null)
                }
            }
        }
    }

    fun changeCwd(path: String, onDone: (Boolean) -> Unit = {}) {
        val targetPath = path.trim()
        if (targetPath.isBlank()) {
            onDone(false)
            return
        }
        viewModelScope.launch {
            val resp = rpcCall("change_cwd", mapOf("path" to targetPath))
            when {
                resp == null -> {
                    _error.value = s(R.string.file_manager_error_change_cwd_no_response)
                    onDone(false)
                }
                resp.has("error") -> {
                    _error.value = resp.optString("error", s(R.string.file_manager_error_change_cwd_failed))
                    onDone(false)
                }
                else -> {
                    val browser = parseDirectoryBrowserState(resp)
                    _directoryBrowser.value = browser.copy(loading = false, error = null)
                    val cwd = browser.cwd.ifBlank { targetPath }
                    _path.value = cwd
                    ls(cwd)
                    onDone(true)
                }
            }
        }
    }

    fun readFile(filePath: String) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val resp = rpcCall("read_file", mapOf("path" to filePath))
            if (resp?.has("error") == true) {
                _error.value = resp.getString("error")
            } else {
                _fileContent.value = resp?.optString("result")
            }
            _loading.value = false
        }
    }

    fun writeFile(filePath: String, content: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            val resp = rpcCall("write_file", mapOf("path" to filePath, "content" to content))
            if (resp?.has("error") == true) _error.value = resp.getString("error")
            else onDone()
        }
    }

    fun mkdir(dirPath: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            val resp = rpcCall("mkdir", mapOf("path" to dirPath))
            if (resp?.has("error") == true) _error.value = resp.getString("error")
            else onDone()
        }
    }

    fun deleteFile(filePath: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            val resp = rpcCall("delete", mapOf("path" to filePath))
            if (resp?.has("error") == true) _error.value = resp.getString("error")
            else onDone()
        }
    }

    fun rename(from: String, to: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            val resp = rpcCall("rename", mapOf("from" to from, "to" to to))
            if (resp?.has("error") == true) _error.value = resp.getString("error")
            else onDone()
        }
    }

    fun uploadUri(
        uri: Uri,
        conflictPolicy: String = "rename",
        onDone: (UploadCommitResult?) -> Unit = {}
    ) {
        viewModelScope.launch {
            _error.value = null
            val app = getApplication<Application>()
            val meta = runCatching { UriFileUtils.resolveMeta(app, uri) }.getOrElse {
                _error.value = it.message ?: s(R.string.file_manager_error_read_file_failed)
                onDone(null)
                return@launch
            }
            val fileKey = "${meta.fileName}:${meta.sizeBytes ?: -1L}"
            val resumeUploadId = uploadResumeMap[fileKey]

            _uploadState.value = UploadState(
                active = true,
                fileName = meta.fileName,
                uploadId = resumeUploadId,
                sentBytes = 0L,
                totalBytes = meta.sizeBytes,
                status = if (resumeUploadId != null) {
                    s(R.string.file_manager_status_prepare_resume)
                } else {
                    s(R.string.file_manager_status_upload_init)
                },
            )

            try {
                val initParams = mutableMapOf<String, Any>(
                    "targetDir" to _path.value.ifBlank { "." },
                    "fileName" to meta.fileName,
                    "conflictPolicy" to conflictPolicy,
                )
                meta.mimeType?.let { initParams["mimeType"] = it }
                meta.sizeBytes?.let { initParams["totalBytes"] = it }
                resumeUploadId?.let { initParams["uploadId"] = it }
                val chunkSize = resolveUploadChunkSize(meta.sizeBytes)
                val initResp = rpcCallWithRetry(
                    method = "upload_init",
                    params = initParams,
                    noResponseError = s(R.string.file_manager_error_upload_init_no_response),
                )
                val initResult = initResp.optJSONObject("result") ?: initResp
                val uploadId = initResult.optString("uploadId")
                if (uploadId.isBlank()) throw IllegalStateException(s(R.string.file_manager_error_upload_id_empty))

                var remoteOffset = initResult.optLong("nextOffset", 0L).coerceAtLeast(0L)
                uploadResumeMap[fileKey] = uploadId
                persistUploadResumeMap()
                _uploadState.value = _uploadState.value.copy(
                    uploadId = uploadId,
                    sentBytes = remoteOffset,
                    status = if (remoteOffset > 0L) {
                        s(R.string.file_manager_status_upload_resuming)
                    } else {
                        s(R.string.file_manager_status_uploading)
                    },
                )

                UriFileUtils.forEachChunk(
                    context = app,
                    uri = uri,
                    chunkSize = chunkSize,
                    skipBytes = remoteOffset,
                ) { chunk ->
                    var chunkOffset = remoteOffset
                    var payload = chunk
                    while (true) {
                        val resp = rpcCallWithRetry(
                            method = "upload_chunk",
                            params = mapOf(
                                "uploadId" to uploadId,
                                "offset" to chunkOffset,
                                "chunkBase64" to Base64.encodeToString(payload, Base64.NO_WRAP),
                            ),
                            noResponseError = s(R.string.file_manager_error_upload_chunk_no_response),
                        )
                        val result = resp.optJSONObject("result") ?: resp
                        val accepted = result.optBoolean("accepted", false)
                        val nextOffset = result.optLong("nextOffset", chunkOffset + payload.size)
                        if (accepted) {
                            remoteOffset = nextOffset
                            break
                        }
                        val reason = result.optString("reason")
                        if (reason != "offset_behind" && reason != "offset_ahead") {
                            throw IllegalStateException(
                                s(
                                    R.string.file_manager_error_upload_failed_with_reason,
                                    reason.ifBlank { s(R.string.common_unknown) },
                                )
                            )
                        }
                        val advanced = (nextOffset - chunkOffset).toInt()
                        if (advanced <= 0 || advanced >= payload.size) {
                            remoteOffset = maxOf(remoteOffset, nextOffset)
                            break
                        }
                        payload = payload.copyOfRange(advanced, payload.size)
                        chunkOffset = nextOffset
                    }

                    _uploadState.value = _uploadState.value.copy(
                        sentBytes = remoteOffset,
                        status = s(R.string.file_manager_status_uploading),
                    )
                }

                val commitResp = rpcCallWithRetry(
                    method = "upload_commit",
                    params = mapOf("uploadId" to uploadId),
                    noResponseError = s(R.string.file_manager_error_upload_commit_no_response),
                )
                val commit = commitResp.optJSONObject("result") ?: commitResp
                if (!commit.optBoolean("committed", false)) {
                    val reason = commit.optString("reason", s(R.string.common_unknown))
                    val nextOffset = commit.optLong("nextOffset", remoteOffset)
                    _uploadState.value = _uploadState.value.copy(
                        active = false,
                        sentBytes = nextOffset,
                        status = s(R.string.file_manager_status_upload_incomplete_retry),
                    )
                    _error.value = s(R.string.file_manager_error_upload_incomplete, reason)
                    onDone(null)
                    return@launch
                }

                uploadResumeMap.remove(fileKey)
                persistUploadResumeMap()
                val path = commit.optString("path")
                _lastUploadedPath.value = path.takeIf { it.isNotBlank() }
                val cleanupMs = commit.optNullableLong("cleanupScheduledMs")
                val uploadResult = if (path.isNotBlank()) {
                    UploadCommitResult(
                        path = path,
                        atPath = commit.optString("atPath").takeIf { it.isNotBlank() },
                        promptRef = commit.optString("promptRef").takeIf { it.isNotBlank() },
                        suggestedPrompt = commit.optString("suggestedPrompt").takeIf { it.isNotBlank() },
                        cleanupScheduledMs = cleanupMs
                    )
                } else {
                    null
                }
                _uploadState.value = _uploadState.value.copy(
                    active = false,
                    sentBytes = commit.optLong("sizeBytes", remoteOffset),
                    status = s(R.string.file_manager_status_upload_done),
                )
                ls(_path.value)
                onDone(uploadResult)
            } catch (e: Exception) {
                _uploadState.value = _uploadState.value.copy(
                    active = false,
                    status = s(R.string.file_manager_status_upload_failed),
                )
                _error.value = e.message ?: s(R.string.file_manager_error_upload_failed)
                onDone(null)
            }
        }
    }

    fun downloadAndCache(remotePath: String, onDone: (DownloadedArtifact?) -> Unit = {}) {
        viewModelScope.launch {
            _error.value = null
            try {
                val resp = rpcCall("download_file", mapOf("path" to remotePath))
                    ?: throw IllegalStateException(s(R.string.file_manager_error_download_no_response))
                if (resp.has("error")) throw IllegalStateException(resp.optString("error"))
                val result = resp.optJSONObject("result") ?: resp
                val contentBase64 = result.optString("contentBase64")
                if (contentBase64.isBlank()) throw IllegalStateException(s(R.string.file_manager_error_download_empty))
                val fileName = UriFileUtils.sanitizeFileName(
                    result.optString("fileName").ifBlank { remotePath.substringAfterLast('/') }
                )
                val mimeType = result.optString("mimeType").ifBlank { "application/octet-stream" }
                val bytes = Base64.decode(contentBase64, Base64.DEFAULT)
                val file = UriFileUtils.writeToShareCache(getApplication(), fileName, bytes)
                val uri = UriFileUtils.toShareUri(getApplication(), file)
                val artifact = DownloadedArtifact(
                    remotePath = remotePath,
                    fileName = fileName,
                    mimeType = mimeType,
                    sizeBytes = result.optLong("sizeBytes", bytes.size.toLong()),
                    uri = uri,
                )
                _downloadedArtifact.value = artifact
                onDone(artifact)
            } catch (e: Exception) {
                _error.value = e.message ?: s(R.string.file_manager_error_download_failed)
                onDone(null)
            }
        }
    }

    fun shareDownloadedArtifact(artifact: DownloadedArtifact? = _downloadedArtifact.value): Boolean {
        val file = artifact ?: return false
        return runCatching {
            val chooser = Intent.createChooser(
                Intent(Intent.ACTION_SEND).apply {
                    type = file.mimeType
                    putExtra(Intent.EXTRA_STREAM, file.uri)
                    putExtra(Intent.EXTRA_SUBJECT, file.fileName)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
                s(R.string.file_manager_share_file_title)
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            getApplication<Application>().startActivity(chooser)
            true
        }.getOrElse {
            _error.value = it.message ?: s(R.string.file_manager_error_share_failed)
            false
        }
    }

    fun sendFileAction(filePath: String, action: FileAgentAction, onDone: (Boolean) -> Unit = {}) {
        val prompt = action.buildPrompt(filePath)
        val ok = sendPrompt(prompt)
        if (!ok) {
            _error.value = s(R.string.file_manager_error_send_prompt_disconnected)
        }
        onDone(ok)
    }

    fun sendCustomPrompt(prompt: String, onDone: (Boolean) -> Unit = {}) {
        val trimmed = prompt.trim()
        if (trimmed.isBlank()) {
            onDone(false)
            return
        }
        val ok = sendPrompt(trimmed)
        if (!ok) {
            _error.value = s(R.string.file_manager_error_send_prompt_disconnected)
        }
        onDone(ok)
    }

    fun runOcr(uri: Uri, onDone: (String?) -> Unit = {}) {
        viewModelScope.launch {
            _ocrState.value = OcrState(running = true, text = "", error = null)
            try {
                val image = InputImage.fromFilePath(getApplication(), uri)
                val text = recognizeText(image)
                _ocrState.value = OcrState(running = false, text = text, error = null)
                onDone(text)
            } catch (e: Exception) {
                val error = e.message ?: s(R.string.file_manager_error_ocr_failed)
                _ocrState.value = OcrState(running = false, text = "", error = error)
                _error.value = error
                onDone(null)
            }
        }
    }

    fun closeFile() {
        _fileContent.value = null
    }

    fun clearError() {
        _error.value = null
    }

    fun clearDownloadArtifact() {
        _downloadedArtifact.value = null
    }

    fun resolvePath(name: String): String {
        val base = _path.value
        return if (base == "." || base.isEmpty()) name else "$base/$name"
    }

    fun navigateUp() {
        val p = _path.value
        val parent = if (p.contains("/")) p.substringBeforeLast("/") else "."
        ls(parent)
    }

    private suspend fun recognizeText(image: InputImage): String {
        val recognizer = TextRecognition.getClient(
            ChineseTextRecognizerOptions.Builder().build()
        )
        return suspendCancellableCoroutine { cont ->
            recognizer.process(image)
                .addOnSuccessListener { result ->
                    cont.resume(result.text)
                }
                .addOnFailureListener { e ->
                    cont.resumeWithException(e)
                }
                .addOnCompleteListener {
                    recognizer.close()
                }
        }
    }

    private fun sendPrompt(prompt: String): Boolean {
        val key = keyStore.sharedKey ?: return false
        val deviceId = keyStore.deviceId ?: return false
        val sessionId = keyStore.sessionId ?: return false
        val activeRelay = relay ?: return false
        if (!activeRelay.isConnected) return false

        return runCatching {
            activeRelay.send(
                EnvelopeHelper.create(
                    source = deviceId,
                    target = "broadcast",
                    sessionId = sessionId,
                    type = "prompt",
                    plaintext = prompt,
                    sharedKey = key
                )
            )
            true
        }.getOrElse { false }
    }

    override fun onCleared() {
        relay?.disconnect()
    }

    private fun loadUploadResumeMap(): MutableMap<String, String> {
        val raw = uploadResumePrefs.getString(KEY_UPLOAD_RESUME_MAP, null) ?: return mutableMapOf()
        val obj = runCatching { JSONObject(raw) }.getOrElse { return mutableMapOf() }
        val out = mutableMapOf<String, String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val uploadId = obj.optString(key).takeIf { it.isNotBlank() } ?: continue
            out[key] = uploadId
        }
        return out
    }

    private fun persistUploadResumeMap() {
        val encoded = JSONObject().apply {
            uploadResumeMap.forEach { (k, v) -> put(k, v) }
        }
        uploadResumePrefs.edit().putString(KEY_UPLOAD_RESUME_MAP, encoded.toString()).apply()
    }

    private fun resolveUploadChunkSize(totalBytes: Long?): Int {
        val size = totalBytes ?: return UPLOAD_CHUNK_DEFAULT_BYTES
        return if (size >= LARGE_UPLOAD_THRESHOLD_BYTES) {
            UPLOAD_CHUNK_LARGE_BYTES
        } else {
            UPLOAD_CHUNK_DEFAULT_BYTES
        }
    }

    private fun retryDelayMs(attempt: Int): Long {
        val delay = UPLOAD_RETRY_BASE_DELAY_MS * (1L shl attempt.coerceAtLeast(0))
        return delay.coerceAtMost(UPLOAD_RETRY_MAX_DELAY_MS)
    }

    companion object {
        private const val RPC_TIMEOUT_MS = 12_000L
        private const val UPLOAD_RPC_TIMEOUT_MS = 30_000L
        private const val UPLOAD_RPC_MAX_ATTEMPTS = 4
        private const val UPLOAD_RETRY_BASE_DELAY_MS = 400L
        private const val UPLOAD_RETRY_MAX_DELAY_MS = 4_000L
        private const val LARGE_UPLOAD_THRESHOLD_BYTES = 32L * 1024L * 1024L
        private const val UPLOAD_CHUNK_DEFAULT_BYTES = 256 * 1024
        private const val UPLOAD_CHUNK_LARGE_BYTES = 512 * 1024
        private const val UPLOAD_RESUME_PREFS = "yuanio_upload_resume"
        private const val KEY_UPLOAD_RESUME_MAP = "upload_resume_map_json"
    }

    private fun parseDirectoryBrowserState(resp: JSONObject): DirectoryBrowserState {
        val result = resp.optJSONObject("result") ?: resp
        val cwd = result.optString("cwd").takeIf { it.isNotBlank() } ?: "."
        val parent = result.optString("parent").takeIf { it.isNotBlank() }

        val roots = buildList {
            val arr = result.optJSONArray("roots")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val item = arr.optString(i).takeIf { it.isNotBlank() } ?: continue
                    add(item)
                }
            }
        }

        val entries = buildList {
            val arr = result.optJSONArray("entries")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val name = item.optString("name").takeIf { it.isNotBlank() } ?: continue
                    val path = item.optString("path").takeIf { it.isNotBlank() } ?: continue
                    add(DirectoryEntry(name = name, path = path))
                }
            }
        }

        return DirectoryBrowserState(
            cwd = cwd,
            parent = parent,
            roots = roots,
            entries = entries
        )
    }
}

private fun JSONObject.optNullableLong(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    return try {
        optDouble(key).toLong()
    } catch (_: Exception) {
        null
    }
}

private fun JSONObject.optNullableInt(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return try {
        optInt(key)
    } catch (_: Exception) {
        null
    }
}

private fun JSONObject.optNullableBoolean(key: String): Boolean? {
    if (!has(key) || isNull(key)) return null
    return try {
        optBoolean(key)
    } catch (_: Exception) {
        null
    }
}

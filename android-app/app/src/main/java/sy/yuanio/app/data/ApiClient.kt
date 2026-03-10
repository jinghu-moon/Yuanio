package sy.yuanio.app.data

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ApiClient(private val serverUrl: String) {
    private val client = OkHttpClient()
    private val json = "application/json".toMediaType()

    data class JoinResult(
        val agentPublicKey: String,
        val sessionToken: String,
        val deviceId: String,
        val sessionId: String
    )

    data class SwitchSessionResult(
        val sessionId: String,
        val tokens: Map<String, String>
    )

    data class SessionListItem(
        val sessionId: String,
        val role: String,
        val firstSeen: Long,
        val lastSeen: Long,
        val onlineCount: Int,
        val onlineRoles: List<String>,
        val hasAgentOnline: Boolean,
        val hasAppOnline: Boolean
    )

    data class SessionListResult(
        val currentSessionId: String?,
        val sessions: List<SessionListItem>
    )

    data class MissedMessagesResult(
        val messages: List<JSONObject>,
        val nextCursor: Long
    )

    suspend fun joinPairing(code: String, publicKey: String): JoinResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("code", code)
            put("publicKey", publicKey)
            put("protocolVersion", PROTOCOL_VERSION)
        }.toString().toRequestBody(json)

        val req = Request.Builder()
            .url("$serverUrl/api/v1/pair/join")
            .post(body)
            .build()

        val res = client.newCall(req).execute()
        if (!res.isSuccessful) throw Exception("Pairing failed: HTTP ${res.code}")

        val obj = JSONObject(res.body!!.string())
        JoinResult(
            agentPublicKey = obj.getString("agentPublicKey"),
            sessionToken = obj.getString("sessionToken"),
            deviceId = obj.getString("deviceId"),
            sessionId = obj.getString("sessionId")
        )
    }

    /** 刷新 token（含宽限期验证） */
    suspend fun refreshToken(currentToken: String): String? = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("$serverUrl/api/v1/token/refresh")
            .header("Authorization", "Bearer $currentToken")
            .post("{}".toRequestBody(json))
            .build()

        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext null

        val obj = JSONObject(res.body!!.string())
        val token = obj.optString("sessionToken")
        token.takeIf { it.isNotBlank() }
    }

    /** 获取断线期间的缺失消息 */
    suspend fun fetchMissedMessages(
        sessionId: String,
        afterTs: Long,
        token: String,
        limit: Int = 200,
        afterCursor: Long = 0L,
    ): MissedMessagesResult = withContext(Dispatchers.IO) {
        val url = buildString {
            append("$serverUrl/api/v1/sessions/$sessionId/messages?limit=$limit")
            if (afterCursor > 0L) append("&afterCursor=$afterCursor")
            if (afterTs > 0L) append("&after=$afterTs")
        }
        val req = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val res = client.newCall(req).execute()
        if (!res.isSuccessful) {
            return@withContext MissedMessagesResult(
                messages = emptyList(),
                nextCursor = afterCursor,
            )
        }

        val obj = JSONObject(res.body!!.string())
        val arr = obj.optJSONArray("messages")
        val nextCursor = obj.optLong("nextCursor", afterCursor)
        val result = mutableListOf<JSONObject>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                result.add(arr.getJSONObject(i))
            }
        }
        MissedMessagesResult(result, nextCursor)
    }

    /** 切换会话（创建新会话或切换到指定会话） */
    suspend fun switchSession(currentToken: String, targetSessionId: String? = null): SwitchSessionResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                if (!targetSessionId.isNullOrBlank()) put("sessionId", targetSessionId)
            }.toString().toRequestBody(json)

            val req = Request.Builder()
                .url("$serverUrl/api/v1/sessions/switch")
                .header("Authorization", "Bearer $currentToken")
                .post(body)
                .build()

            val res = client.newCall(req).execute()
            if (!res.isSuccessful) {
                val text = res.body?.string()
                val msg = try {
                    if (!text.isNullOrBlank()) {
                        val err = JSONObject(text).optString("error")
                        if (err.isNotBlank()) err else text
                    } else "HTTP ${res.code}"
                } catch (_: Exception) {
                    text ?: "HTTP ${res.code}"
                }
                throw Exception("Session switch failed: $msg")
            }

            val obj = JSONObject(res.body!!.string())
            val tokensObj = obj.getJSONObject("tokens")
            val tokens = mutableMapOf<String, String>()
            val keys = tokensObj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                tokens[key] = tokensObj.getString(key)
            }
            SwitchSessionResult(
                sessionId = obj.getString("sessionId"),
                tokens = tokens
            )
        }

    /** Phase 6: 游标分页拉取历史消息（daemon 本地端点） */
    suspend fun fetchMessages(
        daemonUrl: String,
        sessionId: String,
        limit: Int = 50,
        beforeSeq: Int? = null
    ): List<JSONObject> = withContext(Dispatchers.IO) {
        val url = buildString {
            append("$daemonUrl/messages/$sessionId?limit=$limit")
            if (beforeSeq != null) append("&before=$beforeSeq")
        }
        val req = Request.Builder().url(url).get().build()
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext emptyList()
        val arr = JSONObject(res.body!!.string()).optJSONArray("messages")
            ?: return@withContext emptyList()
        (0 until arr.length()).map { arr.getJSONObject(it) }
    }

    /** Phase 6: 增量拉取新消息（daemon 本地端点） */
    suspend fun fetchMessagesAfter(
        daemonUrl: String,
        sessionId: String,
        afterSeq: Int,
        limit: Int = 100
    ): List<JSONObject> = withContext(Dispatchers.IO) {
        val url = "$daemonUrl/messages/$sessionId/after?after=$afterSeq&limit=$limit"
        val req = Request.Builder().url(url).get().build()
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext emptyList()
        val arr = JSONObject(res.body!!.string()).optJSONArray("messages")
            ?: return@withContext emptyList()
        (0 until arr.length()).map { arr.getJSONObject(it) }
    }

    /** 获取远程会话列表（仅返回当前设备可访问的会话） */
    suspend fun fetchSessionList(currentToken: String): SessionListResult = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("$serverUrl/api/v1/sessions")
            .header("Authorization", "Bearer $currentToken")
            .get()
            .build()

        val res = client.newCall(req).execute()
        if (!res.isSuccessful) {
            throw Exception("Failed to fetch sessions: HTTP ${res.code}")
        }

        val obj = JSONObject(res.body!!.string())
        val currentSessionId = obj.optString("currentSessionId").takeIf { it.isNotBlank() }
        val arr = obj.optJSONArray("sessions") ?: org.json.JSONArray()
        val sessions = mutableListOf<SessionListItem>()
        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            val rolesArr = item.optJSONArray("onlineRoles") ?: org.json.JSONArray()
            val roles = mutableListOf<String>()
            for (j in 0 until rolesArr.length()) roles.add(rolesArr.getString(j))
            sessions.add(
                SessionListItem(
                    sessionId = item.getString("sessionId"),
                    role = item.optString("role", "app"),
                    firstSeen = item.optLong("firstSeen", 0L),
                    lastSeen = item.optLong("lastSeen", 0L),
                    onlineCount = item.optInt("onlineCount", 0),
                    onlineRoles = roles,
                    hasAgentOnline = item.optBoolean("hasAgentOnline", false),
                    hasAppOnline = item.optBoolean("hasAppOnline", false)
                )
            )
        }
        SessionListResult(currentSessionId, sessions)
    }
}


package sy.yuanio.app.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

internal data class ChatHistoryEntry(
    val type: String,
    val content: String,
    val taskId: String? = null,
    val agent: String? = null,
    val ts: Long = 0L,
)

internal fun encodeChatHistoryEntries(items: List<ChatHistoryEntry>): String {
    val arr = JSONArray()
    items.forEach { item ->
        val obj = JSONObject()
            .put("t", item.type)
            .put("c", item.content)
        item.taskId?.trim()?.takeIf { it.isNotBlank() }?.let { obj.put("taskId", it) }
        item.agent?.trim()?.takeIf { it.isNotBlank() }?.let { obj.put("agent", it) }
        if (item.ts > 0L) obj.put("ts", item.ts)
        arr.put(obj)
    }
    return arr.toString()
}

internal fun decodeChatHistoryEntries(json: String): List<ChatHistoryEntry> {
    val arr = runCatching { JSONArray(json) }.getOrElse { return emptyList() }
    return (0 until arr.length()).mapNotNull { index ->
        val obj = arr.optJSONObject(index) ?: return@mapNotNull null
        val type = obj.optString("t", "").trim()
        if (type.isBlank()) return@mapNotNull null
        ChatHistoryEntry(
            type = type,
            content = obj.optString("c", ""),
            taskId = obj.optString("taskId", "").trim().ifBlank { null },
            agent = obj.optString("agent", "").trim().ifBlank { null },
            ts = obj.optLong("ts", 0L),
        )
    }
}

class ChatHistory(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context, "yuanio_history",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun save(sessionId: String, items: List<Pair<String, String>>) {
        saveEntries(
            sessionId = sessionId,
            items = items.map { (type, content) ->
                ChatHistoryEntry(type = type, content = content, ts = System.currentTimeMillis())
            },
        )
    }

    internal fun saveEntries(sessionId: String, items: List<ChatHistoryEntry>) {
        val edit = prefs.edit()
        edit.putString(sessionId, encodeChatHistoryEntries(items))
        val preview = items.lastOrNull()?.content?.take(80) ?: ""
        edit.putString(
            "_meta:$sessionId",
            JSONObject()
                .put("updatedAt", System.currentTimeMillis())
                .put("count", items.size)
                .put("preview", preview)
                .toString(),
        )
        edit.apply()
    }

    fun load(sessionId: String): List<Pair<String, String>> {
        return loadEntries(sessionId).map { it.type to it.content }
    }

    internal fun loadEntries(sessionId: String): List<ChatHistoryEntry> {
        val json = prefs.getString(sessionId, null) ?: return emptyList()
        return decodeChatHistoryEntries(json)
    }

    fun sessions(): Set<String> = prefs.all.keys.filter { !it.startsWith("_meta:") }.toSet()

    data class SessionMeta(
        val id: String,
        val updatedAt: Long,
        val count: Int,
        val preview: String,
        val title: String = "",
        val tags: List<String> = emptyList()
    )

    fun sessionList(): List<SessionMeta> = sessions().mapNotNull { sid ->
        val raw = prefs.getString("_meta:$sid", null)
        if (raw != null) {
            val obj = JSONObject(raw)
            val tagsArr = obj.optJSONArray("tags")
            val tags = if (tagsArr != null) (0 until tagsArr.length()).map { tagsArr.getString(it) } else emptyList()
            SessionMeta(
                sid,
                obj.optLong("updatedAt"),
                obj.optInt("count"),
                obj.optString("preview", ""),
                title = obj.optString("title", ""),
                tags = tags
            )
        } else {
            val items = load(sid)
            if (items.isEmpty()) null
            else SessionMeta(sid, 0L, items.size, items.lastOrNull()?.second?.take(80) ?: "")
        }
    }.sortedByDescending { it.updatedAt }

    fun delete(sessionId: String) {
        prefs.edit().remove(sessionId).remove("_meta:$sessionId").apply()
    }

    fun updateTitle(sessionId: String, title: String) {
        val raw = prefs.getString("_meta:$sessionId", null) ?: return
        val obj = JSONObject(raw)
        obj.put("title", title)
        prefs.edit().putString("_meta:$sessionId", obj.toString()).apply()
    }

    fun updateTags(sessionId: String, tags: List<String>) {
        val raw = prefs.getString("_meta:$sessionId", null) ?: return
        val obj = JSONObject(raw)
        obj.put("tags", JSONArray(tags))
        prefs.edit().putString("_meta:$sessionId", obj.toString()).apply()
    }

    fun allTags(): Set<String> {
        val tags = mutableSetOf<String>()
        for (sid in sessions()) {
            val raw = prefs.getString("_meta:$sid", null) ?: continue
            val obj = JSONObject(raw)
            val arr = obj.optJSONArray("tags") ?: continue
            for (i in 0 until arr.length()) tags.add(arr.getString(i))
        }
        return tags
    }

    fun searchSessions(query: String): List<SessionMeta> {
        if (query.isBlank()) return sessionList()
        val q = query.lowercase()
        return sessionList().filter { meta ->
            meta.title.lowercase().contains(q)
                || meta.preview.lowercase().contains(q)
                || meta.id.lowercase().contains(q)
                || meta.tags.any { it.lowercase().contains(q) }
        }
    }
}


package com.yuanio.app.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

class ChatHistory(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context, "yuanio_history",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun save(sessionId: String, items: List<Pair<String, String>>) {
        val arr = JSONArray()
        for ((type, content) in items) {
            arr.put(JSONObject().put("t", type).put("c", content))
        }
        val edit = prefs.edit()
        edit.putString(sessionId, arr.toString())
        // 保存元数据：最后更新时间、消息数、预览
        val preview = items.lastOrNull()?.second?.take(80) ?: ""
        edit.putString("_meta:$sessionId", JSONObject()
            .put("updatedAt", System.currentTimeMillis())
            .put("count", items.size)
            .put("preview", preview)
            .toString())
        edit.apply()
    }

    fun load(sessionId: String): List<Pair<String, String>> {
        val json = prefs.getString(sessionId, null) ?: return emptyList()
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            obj.getString("t") to obj.getString("c")
        }
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

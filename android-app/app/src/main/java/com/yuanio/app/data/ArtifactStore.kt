package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

enum class ArtifactType {
    CODE, HTML, SVG, MERMAID;

    companion object {
        fun detect(lang: String): ArtifactType = when (lang.lowercase().trim()) {
            "html" -> HTML
            "svg" -> SVG
            "mermaid" -> MERMAID
            else -> CODE
        }
    }
}

data class Artifact(
    val id: String,
    val type: ArtifactType,
    val lang: String,
    val content: String,
    val title: String = "",
    val savedAt: Long = System.currentTimeMillis()
)

object ArtifactStore {
    private const val PREFS_NAME = "yuanio_artifacts"
    private const val KEY_LIST = "artifacts"
    private const val MAX_ITEMS = 100

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun save(artifact: Artifact) {
        val list = loadAll().toMutableList()
        // 去重
        list.removeAll { it.id == artifact.id }
        list.add(0, artifact)
        // 限制数量
        while (list.size > MAX_ITEMS) list.removeAt(list.lastIndex)
        persist(list)
    }

    fun remove(id: String) {
        val list = loadAll().toMutableList()
        list.removeAll { it.id == id }
        persist(list)
    }

    fun loadAll(): List<Artifact> {
        val json = prefs.getString(KEY_LIST, null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Artifact(
                    id = obj.getString("id"),
                    type = ArtifactType.valueOf(obj.getString("type")),
                    lang = obj.optString("lang", ""),
                    content = obj.getString("content"),
                    title = obj.optString("title", ""),
                    savedAt = obj.optLong("savedAt", 0L)
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    fun isSaved(id: String): Boolean = loadAll().any { it.id == id }

    private fun persist(list: List<Artifact>) {
        val arr = JSONArray()
        for (a in list) {
            arr.put(JSONObject().apply {
                put("id", a.id)
                put("type", a.type.name)
                put("lang", a.lang)
                put("content", a.content)
                put("title", a.title)
                put("savedAt", a.savedAt)
            })
        }
        prefs.edit().putString(KEY_LIST, arr.toString()).apply()
    }
}

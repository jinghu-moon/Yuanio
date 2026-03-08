package com.yuanio.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class PendingDraft(
    val id: String,
    val text: String,
    val createdAt: Long,
)

class DraftStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    fun add(text: String): PendingDraft {
        val trimmed = text.trim()
        require(trimmed.isNotEmpty()) { "draft text must not be empty" }
        val draft = PendingDraft(
            id = "draft_${System.currentTimeMillis()}_${(0..999).random()}",
            text = trimmed,
            createdAt = System.currentTimeMillis(),
        )
        val list = readAll().toMutableList()
        list.add(draft)
        writeAll(list)
        return draft
    }

    fun list(): List<PendingDraft> = readAll().sortedBy { it.createdAt }

    fun remove(id: String) {
        if (id.isBlank()) return
        val next = readAll().filterNot { it.id == id }
        writeAll(next)
    }

    fun size(): Int = readAll().size

    private fun readAll(): List<PendingDraft> {
        val raw = prefs.getString(KEY_ITEMS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val id = obj.optString("id")
                    val text = obj.optString("text")
                    if (id.isBlank() || text.isBlank()) continue
                    add(
                        PendingDraft(
                            id = id,
                            text = text,
                            createdAt = obj.optLong("createdAt", 0L),
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeAll(items: List<PendingDraft>) {
        val arr = JSONArray()
        items.forEach { item ->
            arr.put(
                JSONObject()
                    .put("id", item.id)
                    .put("text", item.text)
                    .put("createdAt", item.createdAt)
            )
        }
        prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
    }

    companion object {
        private const val PREF_NAME = "yuanio_pending_drafts"
        private const val KEY_ITEMS = "items"
    }
}

package com.yuanio.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class PendingApprovalResponse(
    val approvalId: String,
    val approved: Boolean,
    val ts: Long,
)

class PendingApprovalStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    fun append(approvalId: String, approved: Boolean) {
        val list = readAll().toMutableList()
        list.add(
            PendingApprovalResponse(
                approvalId = approvalId,
                approved = approved,
                ts = System.currentTimeMillis(),
            )
        )
        writeAll(list)
    }

    fun drain(): List<PendingApprovalResponse> {
        val list = readAll()
        prefs.edit().remove(KEY_ITEMS).apply()
        return list
    }

    fun size(): Int = readAll().size

    private fun readAll(): List<PendingApprovalResponse> {
        val raw = prefs.getString(KEY_ITEMS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    val id = item.optString("id")
                    if (id.isBlank()) continue
                    add(
                        PendingApprovalResponse(
                            approvalId = id,
                            approved = item.optBoolean("approved", false),
                            ts = item.optLong("ts", 0L),
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeAll(items: List<PendingApprovalResponse>) {
        val array = JSONArray()
        items.forEach { item ->
            array.put(
                JSONObject()
                    .put("id", item.approvalId)
                    .put("approved", item.approved)
                    .put("ts", item.ts)
            )
        }
        prefs.edit().putString(KEY_ITEMS, array.toString()).apply()
    }

    companion object {
        private const val PREF_NAME = "yuanio_pending_approvals"
        private const val KEY_ITEMS = "items"
    }
}

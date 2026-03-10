package sy.yuanio.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class PendingInteractionAction(
    val action: String,
    val approvalId: String? = null,
    val taskId: String? = null,
    val path: String? = null,
    val prompt: String? = null,
    val reason: String? = null,
    val ts: Long,
)

class PendingInteractionActionStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    fun append(payload: InteractionActionIntentPayload) {
        val list = readAll().toMutableList()
        list.add(
            PendingInteractionAction(
                action = payload.action,
                approvalId = payload.approvalId,
                taskId = payload.taskId,
                path = payload.path,
                prompt = payload.prompt,
                reason = payload.reason,
                ts = System.currentTimeMillis(),
            )
        )
        writeAll(list)
    }

    fun drain(): List<PendingInteractionAction> {
        val list = readAll()
        prefs.edit().remove(KEY_ITEMS).apply()
        return list
    }

    private fun readAll(): List<PendingInteractionAction> {
        val raw = prefs.getString(KEY_ITEMS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val action = item.optString("action")
                    if (action.isBlank()) continue
                    add(
                        PendingInteractionAction(
                            action = action,
                            approvalId = item.optString("approvalId").takeIf { it.isNotBlank() },
                            taskId = item.optString("taskId").takeIf { it.isNotBlank() },
                            path = item.optString("path").takeIf { it.isNotBlank() },
                            prompt = item.optString("prompt").takeIf { it.isNotBlank() },
                            reason = item.optString("reason").takeIf { it.isNotBlank() },
                            ts = item.optLong("ts", 0L),
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeAll(items: List<PendingInteractionAction>) {
        val arr = JSONArray()
        items.forEach { item ->
            arr.put(
                JSONObject()
                    .put("action", item.action)
                    .put("approvalId", item.approvalId)
                    .put("taskId", item.taskId)
                    .put("path", item.path)
                    .put("prompt", item.prompt)
                    .put("reason", item.reason)
                    .put("ts", item.ts)
            )
        }
        prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
    }

    companion object {
        private const val PREF_NAME = "yuanio_pending_interaction_actions"
        private const val KEY_ITEMS = "items"
    }
}



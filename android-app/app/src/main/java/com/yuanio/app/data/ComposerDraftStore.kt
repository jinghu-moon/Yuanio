package com.yuanio.app.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private const val MAX_RECENT_DRAFT_SESSIONS = 20

private val Context.composerDraftDataStore by preferencesDataStore(name = "yuanio_composer_drafts")

class ComposerDraftStore(private val context: Context) {
    suspend fun loadDraft(sessionId: String): String {
        if (sessionId.isBlank()) return ""
        val key = draftKey(sessionId)
        val data = context.composerDraftDataStore.data.first()
        return data[key].orEmpty()
    }

    suspend fun saveDraft(sessionId: String, text: String) {
        if (sessionId.isBlank()) return
        val now = System.currentTimeMillis()
        val normalized = text.trimEnd()
        context.composerDraftDataStore.edit { prefs ->
            val key = draftKey(sessionId)
            val tsKey = draftTsKey(sessionId)
            if (normalized.isBlank()) {
                prefs.remove(key)
                prefs.remove(tsKey)
            } else {
                prefs[key] = normalized
                prefs[tsKey] = now
            }
            trimOverflowSessions(prefs)
        }
    }

    suspend fun clearDraft(sessionId: String) {
        if (sessionId.isBlank()) return
        context.composerDraftDataStore.edit { prefs ->
            prefs.remove(draftKey(sessionId))
            prefs.remove(draftTsKey(sessionId))
        }
    }

    private fun trimOverflowSessions(prefs: MutablePreferences) {
        val sessions = prefs.asMap()
            .filterKeys { it.name.startsWith(KEY_TS_PREFIX) }
            .mapNotNull { (key, value) ->
                val ts = value as? Long ?: return@mapNotNull null
                val sessionId = key.name.removePrefix(KEY_TS_PREFIX)
                sessionId.takeIf { it.isNotBlank() }?.let { it to ts }
            }
            .sortedByDescending { it.second }
        if (sessions.size <= MAX_RECENT_DRAFT_SESSIONS) return
        sessions.drop(MAX_RECENT_DRAFT_SESSIONS).forEach { (sessionId, _) ->
            prefs.remove(draftKey(sessionId))
            prefs.remove(draftTsKey(sessionId))
        }
    }

    private fun draftKey(sessionId: String): Preferences.Key<String> {
        return stringPreferencesKey("$KEY_DRAFT_PREFIX$sessionId")
    }

    private fun draftTsKey(sessionId: String): Preferences.Key<Long> {
        return longPreferencesKey("$KEY_TS_PREFIX$sessionId")
    }

    companion object {
        private const val KEY_DRAFT_PREFIX = "draft_"
        private const val KEY_TS_PREFIX = "draft_ts_"
    }
}

package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import sy.yuanio.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class TerminalTheme { DARK, LIGHT }

/** 光标样式 */
enum class CursorStyle { BAR, BLOCK, UNDERLINE }

/** 响铃方式 */
enum class BellStyle { NONE, VISUAL, AUDIBLE }

data class TerminalProfile(
    val id: String,
    val name: String,
    val shell: String,
    val cwd: String,
    val fontSize: Int,
    val scrollback: Int,
    val theme: TerminalTheme,
    // ── 新增字段（P0 增强）──
    val colorSchemeName: String = "",     // 空字符串时根据 theme 自动选择
    val envVars: Map<String, String> = emptyMap(),  // 自定义环境变量
    val startupCommand: String = "",      // 启动后自动执行的命令
    val cursorStyle: CursorStyle = CursorStyle.BAR,
    val bellStyle: BellStyle = BellStyle.VISUAL,
    val icon: String? = null,             // Tab 显示的 emoji 图标
)

data class TerminalTabSnapshot(
    val id: String,
    val profileId: String,
    val title: String,
)

data class TerminalTabState(
    val tabs: List<TerminalTabSnapshot>,
    val activeId: String?,
)

data class QuickCommand(
    val id: String,
    val name: String,
    val command: String,
    val appendNewline: Boolean,
)

object TerminalPrefs {
    private const val PREFS_NAME = "yuanio_terminal_prefs"
    private const val KEY_PROFILES = "profiles"
    private const val KEY_ACTIVE = "active_profile_id"
    private const val KEY_MAX_TABS = "max_tabs"
    private const val KEY_TABS = "terminal_tabs"
    private const val KEY_ACTIVE_TAB = "terminal_active_tab"
    private const val KEY_QUICK_COMMANDS = "terminal_quick_commands"
    private const val KEY_SEARCH_HISTORY = "terminal_search_history"
    private const val KEY_PROFILE_SHORTCUTS = "terminal_profile_shortcuts"
    private const val KEY_PROFILE_EXPORT_VERSION = "terminal_profiles_export_version"

    private const val MAX_SEARCH_HISTORY = 10
    private const val MAX_QUICK_COMMANDS = 20

    private lateinit var appContext: Context
    private lateinit var prefs: SharedPreferences
    private val profiles = mutableListOf<TerminalProfile>()
    private var activeId: String? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        loadProfiles()
    }

    private fun loadProfiles() {
        profiles.clear()
        val raw = prefs.getString(KEY_PROFILES, null)
        if (raw.isNullOrBlank()) {
            // 旧版本迁移
            val legacyFont = prefs.getInt("font_size", 13)
            val legacyScroll = prefs.getInt("scrollback", 2000)
            val legacyTheme = TerminalTheme.entries.getOrElse(prefs.getInt("theme", 0)) { TerminalTheme.DARK }
            val legacyShell = prefs.getString("shell", "") ?: ""
            val legacyCwd = prefs.getString("cwd", "") ?: ""
            val id = UUID.randomUUID().toString()
            profiles.add(
                TerminalProfile(
                    id = id,
                    name = defaultProfileName(),
                    shell = legacyShell,
                    cwd = legacyCwd,
                    fontSize = legacyFont,
                    scrollback = legacyScroll,
                    theme = legacyTheme,
                )
            )
            activeId = prefs.getString(KEY_ACTIVE, id) ?: id
            persist()
            return
        }

        val arr = JSONArray(raw)
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            // 反序列化 envVars
            val envMap = mutableMapOf<String, String>()
            val envObj = obj.optJSONObject("envVars")
            if (envObj != null) {
                envObj.keys().forEach { k -> envMap[k] = envObj.optString(k, "") }
            }
            profiles.add(
                TerminalProfile(
                    id = obj.getString("id"),
                    name = obj.optString("name", defaultProfileName()),
                    shell = obj.optString("shell", ""),
                    cwd = obj.optString("cwd", ""),
                    fontSize = obj.optInt("fontSize", 13),
                    scrollback = obj.optInt("scrollback", 2000),
                    theme = TerminalTheme.entries.getOrElse(obj.optInt("theme", 0)) { TerminalTheme.DARK },
                    colorSchemeName = obj.optString("colorSchemeName", ""),
                    envVars = envMap,
                    startupCommand = obj.optString("startupCommand", ""),
                    cursorStyle = CursorStyle.entries.getOrElse(obj.optInt("cursorStyle", 0)) { CursorStyle.BAR },
                    bellStyle = BellStyle.entries.getOrElse(obj.optInt("bellStyle", 1)) { BellStyle.VISUAL },
                    icon = obj.optString("icon", "").takeIf { it.isNotBlank() },
                )
            )
        }
        if (profiles.isEmpty()) {
            val id = UUID.randomUUID().toString()
            profiles.add(
                TerminalProfile(
                    id = id,
                    name = defaultProfileName(),
                    shell = "",
                    cwd = "",
                    fontSize = 13,
                    scrollback = 2000,
                    theme = TerminalTheme.DARK,
                )
            )
            activeId = id
            persist()
            return
        }
        activeId = prefs.getString(KEY_ACTIVE, profiles.first().id) ?: profiles.first().id
    }

    private fun persist() {
        val arr = JSONArray()
        for (p in profiles) {
            val envObj = JSONObject()
            p.envVars.forEach { (k, v) -> envObj.put(k, v) }
            arr.put(
                JSONObject()
                    .put("id", p.id)
                    .put("name", p.name)
                    .put("shell", p.shell)
                    .put("cwd", p.cwd)
                    .put("fontSize", p.fontSize)
                    .put("scrollback", p.scrollback)
                    .put("theme", p.theme.ordinal)
                    .put("colorSchemeName", p.colorSchemeName)
                    .put("envVars", envObj)
                    .put("startupCommand", p.startupCommand)
                    .put("cursorStyle", p.cursorStyle.ordinal)
                    .put("bellStyle", p.bellStyle.ordinal)
                    .put("icon", p.icon ?: "")
            )
        }
        prefs.edit()
            .putString(KEY_PROFILES, arr.toString())
            .putString(KEY_ACTIVE, activeId ?: profiles.first().id)
            .apply()
    }

    fun getProfiles(): List<TerminalProfile> = profiles.toList()

    var activeProfileId: String
        get() = activeId ?: profiles.first().id
        set(value) {
            if (profiles.any { it.id == value }) {
                activeId = value
                prefs.edit().putString(KEY_ACTIVE, value).apply()
            }
        }

    fun setActiveProfile(id: String) {
        activeProfileId = id
    }

    fun addProfile(profile: TerminalProfile, setActive: Boolean = true) {
        profiles.add(profile)
        if (setActive) activeId = profile.id
        persist()
    }

    fun updateProfile(profile: TerminalProfile) {
        val idx = profiles.indexOfFirst { it.id == profile.id }
        if (idx >= 0) {
            profiles[idx] = profile
            persist()
        }
    }

    fun removeProfile(id: String) {
        if (profiles.size <= 1) return
        profiles.removeAll { it.id == id }
        if (activeId == id) activeId = profiles.first().id
        persist()
    }

    fun createProfile(
        name: String,
        shell: String,
        cwd: String,
        fontSize: Int,
        scrollback: Int,
        theme: TerminalTheme,
    ): TerminalProfile {
        return TerminalProfile(
            id = UUID.randomUUID().toString(),
            name = name.trim().ifBlank { unnamed() },
            shell = shell.trim(),
            cwd = cwd.trim(),
            fontSize = fontSize.coerceIn(10, 22),
            scrollback = scrollback.coerceIn(500, 10000),
            theme = theme,
        )
    }

    private fun activeProfile(): TerminalProfile {
        val id = activeProfileId
        return profiles.firstOrNull { it.id == id } ?: profiles.first()
    }

    private fun updateActive(transform: (TerminalProfile) -> TerminalProfile) {
        val current = activeProfile()
        updateProfile(transform(current))
    }

    var fontSize: Int
        get() = activeProfile().fontSize
        set(value) = updateActive { it.copy(fontSize = value.coerceIn(10, 22)) }

    var scrollback: Int
        get() = activeProfile().scrollback
        set(value) = updateActive { it.copy(scrollback = value.coerceIn(500, 10000)) }

    var theme: TerminalTheme
        get() = activeProfile().theme
        set(value) = updateActive { it.copy(theme = value) }

    var shell: String
        get() = activeProfile().shell
        set(value) = updateActive { it.copy(shell = value.trim()) }

    var cwd: String
        get() = activeProfile().cwd
        set(value) = updateActive { it.copy(cwd = value.trim()) }

    fun saveTabSnapshot(tabs: List<TerminalTabSnapshot>, activeId: String?) {
        val arr = JSONArray()
        for (tab in tabs) {
            arr.put(
                JSONObject()
                    .put("id", tab.id)
                    .put("profileId", tab.profileId)
                    .put("title", tab.title)
            )
        }
        prefs.edit()
            .putString(KEY_TABS, arr.toString())
            .putString(KEY_ACTIVE_TAB, activeId ?: "")
            .apply()
    }

    fun getTabSnapshot(): TerminalTabState {
        val raw = prefs.getString(KEY_TABS, null)
        if (raw.isNullOrBlank()) return TerminalTabState(emptyList(), null)
        val arr = JSONArray(raw)
        val tabs = mutableListOf<TerminalTabSnapshot>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            tabs.add(
                TerminalTabSnapshot(
                    id = obj.getString("id"),
                    profileId = obj.optString("profileId", activeProfileId),
                    title = obj.optString("title", "")
                )
            )
        }
        val active = prefs.getString(KEY_ACTIVE_TAB, null)?.ifBlank { null }
        return TerminalTabState(tabs, active)
    }

    fun clearTabSnapshot() {
        prefs.edit()
            .remove(KEY_TABS)
            .remove(KEY_ACTIVE_TAB)
            .apply()
    }

    fun getQuickCommands(): List<QuickCommand> {
        val raw = prefs.getString(KEY_QUICK_COMMANDS, null) ?: return emptyList()
        val arr = JSONArray(raw)
        val items = mutableListOf<QuickCommand>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            items.add(
                QuickCommand(
                    id = obj.getString("id"),
                    name = obj.optString("name", unnamed()),
                    command = obj.optString("command", ""),
                    appendNewline = obj.optBoolean("appendNewline", true)
                )
            )
        }
        return items
    }

    fun createQuickCommand(
        name: String,
        command: String,
        appendNewline: Boolean,
    ): QuickCommand {
        return QuickCommand(
            id = UUID.randomUUID().toString(),
            name = name.trim().ifBlank { unnamed() },
            command = command,
            appendNewline = appendNewline
        )
    }

    private fun persistQuickCommands(list: List<QuickCommand>) {
        val arr = JSONArray()
        for (cmd in list) {
            arr.put(
                JSONObject()
                    .put("id", cmd.id)
                    .put("name", cmd.name)
                    .put("command", cmd.command)
                    .put("appendNewline", cmd.appendNewline)
            )
        }
        prefs.edit().putString(KEY_QUICK_COMMANDS, arr.toString()).apply()
    }

    fun addQuickCommand(cmd: QuickCommand) {
        val list = getQuickCommands().toMutableList()
        if (list.size >= MAX_QUICK_COMMANDS) return
        list.add(cmd)
        persistQuickCommands(list)
    }

    fun updateQuickCommand(cmd: QuickCommand) {
        val list = getQuickCommands().toMutableList()
        val idx = list.indexOfFirst { it.id == cmd.id }
        if (idx >= 0) {
            list[idx] = cmd
            persistQuickCommands(list)
        }
    }

    fun removeQuickCommand(id: String) {
        val list = getQuickCommands().toMutableList()
        val next = list.filterNot { it.id == id }
        if (next.size != list.size) persistQuickCommands(next)
    }

    fun getSearchHistory(): List<String> {
        val raw = prefs.getString(KEY_SEARCH_HISTORY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        val list = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val q = arr.optString(i, "").trim()
            if (q.isNotBlank()) list.add(q)
        }
        return list
    }

    fun addSearchHistory(query: String) {
        val q = query.trim()
        if (q.isBlank()) return
        val list = getSearchHistory().toMutableList()
        list.removeAll { it.equals(q, ignoreCase = true) }
        list.add(0, q)
        val finalList = list.take(MAX_SEARCH_HISTORY)
        val arr = JSONArray()
        finalList.forEach { arr.put(it) }
        prefs.edit().putString(KEY_SEARCH_HISTORY, arr.toString()).apply()
    }

    fun clearSearchHistory() {
        prefs.edit().remove(KEY_SEARCH_HISTORY).apply()
    }

    fun getProfileShortcuts(): Map<Int, String> {
        val raw = prefs.getString(KEY_PROFILE_SHORTCUTS, null) ?: return emptyMap()
        val arr = JSONArray(raw)
        val map = mutableMapOf<Int, String>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            val slot = obj.optInt("slot", 0)
            val id = obj.optString("profileId", "")
            if (slot in 1..3 && id.isNotBlank()) map[slot] = id
        }
        return map
    }

    fun setProfileShortcut(slot: Int, profileId: String?) {
        if (slot !in 1..3) return
        val map = getProfileShortcuts().toMutableMap()
        if (profileId.isNullOrBlank()) map.remove(slot) else map[slot] = profileId
        val arr = JSONArray()
        for ((s, id) in map.entries.sortedBy { it.key }) {
            arr.put(JSONObject().put("slot", s).put("profileId", id))
        }
        prefs.edit().putString(KEY_PROFILE_SHORTCUTS, arr.toString()).apply()
    }

    fun exportProfilesJson(): String {
        val obj = JSONObject()
            .put(KEY_PROFILE_EXPORT_VERSION, 1)
            .put("activeProfileId", activeProfileId)
            .put("maxTabs", maxTabs)
        val profs = JSONArray()
        for (p in profiles) {
            profs.put(
                JSONObject()
                    .put("id", p.id)
                    .put("name", p.name)
                    .put("shell", p.shell)
                    .put("cwd", p.cwd)
                    .put("fontSize", p.fontSize)
                    .put("scrollback", p.scrollback)
                    .put("theme", p.theme.ordinal)
            )
        }
        val shortcuts = JSONArray()
        for ((slot, id) in getProfileShortcuts()) {
            shortcuts.put(JSONObject().put("slot", slot).put("profileId", id))
        }
        obj.put("profiles", profs)
        obj.put("shortcuts", shortcuts)
        return obj.toString()
    }

    fun importProfilesJson(raw: String, replace: Boolean): Int {
        val root = JSONObject(raw)
        val arr = root.optJSONArray("profiles") ?: JSONArray()
        val incoming = mutableListOf<TerminalProfile>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            incoming.add(
                TerminalProfile(
                    id = obj.getString("id"),
                    name = obj.optString("name", unnamed()),
                    shell = obj.optString("shell", ""),
                    cwd = obj.optString("cwd", ""),
                    fontSize = obj.optInt("fontSize", 13),
                    scrollback = obj.optInt("scrollback", 2000),
                    theme = TerminalTheme.entries.getOrElse(obj.optInt("theme", 0)) { TerminalTheme.DARK }
                )
            )
        }
        if (incoming.isEmpty()) return 0

        val existingIds = profiles.map { it.id }.toMutableSet()
        val idMap = mutableMapOf<String, String>()
        val normalized = incoming.map { p ->
            if (existingIds.contains(p.id)) {
                val newId = UUID.randomUUID().toString()
                existingIds.add(newId)
                idMap[p.id] = newId
                p.copy(id = newId, name = "${p.name} ${importedSuffix()}")
            } else {
                existingIds.add(p.id)
                idMap[p.id] = p.id
                p
            }
        }

        if (replace) {
            profiles.clear()
            profiles.addAll(normalized)
        } else {
            profiles.addAll(normalized)
        }

        val importedActive = root.optString("activeProfileId", "")
        if (importedActive.isNotBlank()) {
            activeId = idMap[importedActive] ?: activeId
        }
        val importedMaxTabs = root.optInt("maxTabs", -1)
        if (replace && importedMaxTabs > 0) {
            maxTabs = importedMaxTabs
        }

        if (replace) {
            val shortcutArr = root.optJSONArray("shortcuts") ?: JSONArray()
            val shortcutMap = mutableMapOf<Int, String>()
            for (i in 0 until shortcutArr.length()) {
                val obj = shortcutArr.getJSONObject(i)
                val slot = obj.optInt("slot", 0)
                val rawId = obj.optString("profileId", "")
                val mapped = idMap[rawId]
                if (slot in 1..3 && !mapped.isNullOrBlank()) shortcutMap[slot] = mapped
            }
            val out = JSONArray()
            for ((slot, id) in shortcutMap.entries.sortedBy { it.key }) {
                out.put(JSONObject().put("slot", slot).put("profileId", id))
            }
            prefs.edit().putString(KEY_PROFILE_SHORTCUTS, out.toString()).apply()
        } else {
            val existingShortcuts = getProfileShortcuts().toMutableMap()
            val shortcutArr = root.optJSONArray("shortcuts") ?: JSONArray()
            for (i in 0 until shortcutArr.length()) {
                val obj = shortcutArr.getJSONObject(i)
                val slot = obj.optInt("slot", 0)
                val rawId = obj.optString("profileId", "")
                val mapped = idMap[rawId]
                if (slot in 1..3 && mapped != null && !existingShortcuts.containsKey(slot)) {
                    existingShortcuts[slot] = mapped
                }
            }
            val out = JSONArray()
            for ((slot, id) in existingShortcuts.entries.sortedBy { it.key }) {
                out.put(JSONObject().put("slot", slot).put("profileId", id))
            }
            prefs.edit().putString(KEY_PROFILE_SHORTCUTS, out.toString()).apply()
        }

        if (activeId == null || profiles.none { it.id == activeId }) {
            activeId = profiles.firstOrNull()?.id
        }

        persist()
        return normalized.size
    }

    var maxTabs: Int
        get() = prefs.getInt(KEY_MAX_TABS, 3)
        set(value) = prefs.edit().putInt(KEY_MAX_TABS, value.coerceIn(1, 6)).apply()

    private fun defaultProfileName(): String = appContext.getString(R.string.terminal_prefs_default_name)
    private fun unnamed(): String = appContext.getString(R.string.terminal_prefs_unnamed)
    private fun importedSuffix(): String = appContext.getString(R.string.terminal_prefs_import_suffix)
}


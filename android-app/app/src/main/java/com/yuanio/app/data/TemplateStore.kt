package com.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import com.yuanio.app.R

data class Template(
    val id: String,
    val label: String,
    val prompt: String,
    val builtIn: Boolean
)

object TemplateStore {
    private const val PREFS_NAME = "yuanio_templates"
    private lateinit var prefs: SharedPreferences
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getAll(): List<Template> {
        val custom = getCustomTemplates()
        return builtInTemplates() + custom
    }

    fun addCustom(label: String, prompt: String) {
        val id = "custom_${System.currentTimeMillis()}"
        val templates = getCustomTemplates().toMutableList()
        templates.add(Template(id, label, prompt, builtIn = false))
        saveCustomTemplates(templates)
    }

    fun deleteCustom(id: String) {
        val templates = getCustomTemplates().filter { it.id != id }
        saveCustomTemplates(templates)
    }

    fun updateCustom(id: String, label: String, prompt: String) {
        val templates = getCustomTemplates().map {
            if (it.id == id) it.copy(label = label, prompt = prompt) else it
        }
        saveCustomTemplates(templates)
    }

    private fun getCustomTemplates(): List<Template> {
        val json = prefs.getString("custom_templates", null) ?: return emptyList()
        return try {
            val arr = org.json.JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Template(
                    id = obj.getString("id"),
                    label = obj.getString("label"),
                    prompt = obj.getString("prompt"),
                    builtIn = false
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    private fun saveCustomTemplates(templates: List<Template>) {
        val arr = org.json.JSONArray()
        templates.forEach { t ->
            arr.put(org.json.JSONObject().apply {
                put("id", t.id)
                put("label", t.label)
                put("prompt", t.prompt)
            })
        }
        prefs.edit().putString("custom_templates", arr.toString()).apply()
    }

    private fun builtInTemplates(): List<Template> {
        return listOf(
            Template(
                "builtin_fix",
                appContext.getString(R.string.template_builtin_fix_label),
                appContext.getString(R.string.template_builtin_fix_prompt),
                builtIn = true,
            ),
            Template(
                "builtin_review",
                appContext.getString(R.string.template_builtin_review_label),
                appContext.getString(R.string.template_builtin_review_prompt),
                builtIn = true,
            ),
            Template(
                "builtin_test",
                appContext.getString(R.string.template_builtin_test_label),
                appContext.getString(R.string.template_builtin_test_prompt),
                builtIn = true,
            ),
            Template(
                "builtin_explain",
                appContext.getString(R.string.template_builtin_explain_label),
                appContext.getString(R.string.template_builtin_explain_prompt),
                builtIn = true,
            ),
            Template(
                "builtin_refactor",
                appContext.getString(R.string.template_builtin_refactor_label),
                appContext.getString(R.string.template_builtin_refactor_prompt),
                builtIn = true,
            ),
            Template(
                "builtin_comment",
                appContext.getString(R.string.template_builtin_comment_label),
                appContext.getString(R.string.template_builtin_comment_prompt),
                builtIn = true,
            ),
        )
    }
}

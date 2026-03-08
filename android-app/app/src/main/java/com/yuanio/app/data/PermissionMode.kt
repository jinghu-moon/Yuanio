package com.yuanio.app.data

import androidx.annotation.StringRes
import com.yuanio.app.R

enum class PermissionMode(val value: String, @param:StringRes @field:StringRes val labelRes: Int) {
    DEFAULT("default", R.string.permission_mode_default),
    ACCEPT_EDITS("acceptEdits", R.string.permission_mode_accept_edits),
    BYPASS("bypass", R.string.permission_mode_bypass),
    PLAN("plan", R.string.permission_mode_plan);

    companion object {
        fun fromValue(value: String): PermissionMode =
            entries.firstOrNull { it.value == value } ?: DEFAULT
    }
}

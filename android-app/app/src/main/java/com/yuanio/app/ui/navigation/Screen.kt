package com.yuanio.app.ui.navigation

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

sealed class Screen(val route: String) {
    data object Pairing : Screen("pairing")
    data object Home : Screen("home")
    data object Environment : Screen("environment")
    data object Sessions : Screen("sessions")
    data object Chat : Screen("chat?sessionId={sessionId}&taskId={taskId}") {
        fun routeWithSession(sessionId: String? = null): String {
            return if (sessionId.isNullOrBlank()) "chat" else "chat?sessionId=${encodeQueryValue(sessionId)}"
        }

        fun routeWithTask(taskId: String): String {
            val normalized = taskId.trim()
            return if (normalized.isBlank()) {
                "chat"
            } else {
                "chat?taskId=${encodeQueryValue(normalized)}"
            }
        }
    }
    data object Settings : Screen("settings")
    data object Files : Screen("files")
    data object Skills : Screen("skills")
    data object Tasks : Screen("tasks?focus={focus}&taskId={taskId}") {
        fun routeWithFocusLatest(): String {
            return routeWithFocus("latest")
        }

        fun routeWithFocus(focus: String, taskId: String? = null): String {
            val normalizedFocus = focus.trim().lowercase()
            if (normalizedFocus.isBlank()) return "tasks"
            val normalizedTaskId = taskId?.trim().orEmpty()
            return if (normalizedTaskId.isBlank()) {
                "tasks?focus=${encodeQueryValue(normalizedFocus)}"
            } else {
                "tasks?focus=${encodeQueryValue(normalizedFocus)}&taskId=${encodeQueryValue(normalizedTaskId)}"
            }
        }
    }
    data object Approvals : Screen("approvals?approvalId={approvalId}") {
        fun routeWithApproval(approvalId: String): String {
            val normalized = approvalId.trim()
            return if (normalized.isBlank()) {
                "approvals"
            } else {
                "approvals?approvalId=${encodeQueryValue(normalized)}"
            }
        }
    }
    data object Results : Screen("results?taskId={taskId}") {
        fun routeWithTask(taskId: String): String {
            val normalized = taskId.trim()
            return if (normalized.isBlank()) {
                "results"
            } else {
                "results?taskId=${encodeQueryValue(normalized)}"
            }
        }
    }
    data object Terminal : Screen("terminal")
    data object Git : Screen("git")
}

private fun encodeQueryValue(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8.toString())
}

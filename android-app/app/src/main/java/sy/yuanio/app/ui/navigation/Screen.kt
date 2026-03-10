package sy.yuanio.app.ui.navigation

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

sealed class Screen(val route: String) {
    data object Pairing : Screen("pairing")
    data object Home : Screen("home")
    data object Environment : Screen("environment")
    data object Sessions : Screen("sessions")
    data object Chat : Screen("chat?sessionId={sessionId}&taskId={taskId}") {
        fun routeWithSession(sessionId: String? = null): String {
            return routeWithContext(sessionId = sessionId)
        }

        fun routeWithTask(taskId: String): String {
            return routeWithContext(taskId = taskId)
        }

        fun routeWithContext(sessionId: String? = null, taskId: String? = null): String {
            return buildOptionalQueryRoute(
                base = "chat",
                params = listOf(
                    "sessionId" to sessionId,
                    "taskId" to taskId,
                ),
            )
        }
    }
    data object Settings : Screen("settings")
    data object Files : Screen("files?query={query}&taskId={taskId}") {
        fun routeWithContext(query: String? = null, taskId: String? = null): String {
            return buildOptionalQueryRoute(
                base = "files",
                params = listOf(
                    "query" to query,
                    "taskId" to taskId,
                ),
            )
        }
    }
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
    data object Results : Screen("results?taskId={taskId}&mode={mode}") {
        fun routeWithTask(taskId: String): String {
            return routeWithContext(taskId = taskId)
        }

        fun routeWithContext(taskId: String? = null, mode: String? = null): String {
            return buildOptionalQueryRoute(
                base = "results",
                params = listOf(
                    "taskId" to taskId,
                    "mode" to mode,
                ),
            )
        }
    }
    data object Terminal : Screen("terminal")
    data object Git : Screen("git?tab={tab}&taskId={taskId}") {
        fun routeWithContext(tab: String? = null, taskId: String? = null): String {
            return buildOptionalQueryRoute(
                base = "git",
                params = listOf(
                    "tab" to tab,
                    "taskId" to taskId,
                ),
            )
        }
    }
}

private fun encodeQueryValue(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8.toString())
}

private fun buildOptionalQueryRoute(
    base: String,
    params: List<Pair<String, String?>>,
): String {
    val query = params.mapNotNull { (key, rawValue) ->
        val value = rawValue?.trim().orEmpty()
        if (value.isBlank()) {
            null
        } else {
            "$key=${encodeQueryValue(value)}"
        }
    }
    return if (query.isEmpty()) {
        base
    } else {
        "$base?${query.joinToString("&")}"
    }
}


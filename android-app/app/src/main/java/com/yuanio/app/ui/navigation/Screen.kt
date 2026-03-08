package com.yuanio.app.ui.navigation

sealed class Screen(val route: String) {
    data object Pairing : Screen("pairing")
    data object Sessions : Screen("sessions")
    data object Chat : Screen("chat?sessionId={sessionId}") {
        fun routeWithSession(sessionId: String? = null): String {
            return if (sessionId.isNullOrBlank()) "chat" else "chat?sessionId=$sessionId"
        }
    }
    data object Settings : Screen("settings")
    data object Files : Screen("files")
    data object Skills : Screen("skills")
    data object Terminal : Screen("terminal")
    data object Git : Screen("git")
}

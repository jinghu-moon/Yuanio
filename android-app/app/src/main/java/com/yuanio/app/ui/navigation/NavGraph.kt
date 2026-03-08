package com.yuanio.app.ui.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import com.yuanio.app.ui.screen.PairingScreen
import com.yuanio.app.ui.screen.ChatScreen
import com.yuanio.app.ui.screen.SettingsScreen
import com.yuanio.app.ui.screen.SessionListScreen
import com.yuanio.app.ui.screen.FileManagerScreen
import com.yuanio.app.ui.screen.TerminalScreen
import com.yuanio.app.ui.screen.GitScreen
import com.yuanio.app.ui.screen.SkillsScreen
import com.yuanio.app.ui.component.MainBottomBar
import com.yuanio.app.ui.component.MainTab

@Composable
fun YuanioNavGraph(
    navController: NavHostController,
    onPaired: (() -> Unit)? = null,
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val route = navBackStackEntry?.destination?.route ?: ""

    val showBottomBar = route.startsWith("chat")
            || route == Screen.Sessions.route
            || route == Screen.Settings.route
            || route == Screen.Terminal.route
            || route == Screen.Files.route
            || route == Screen.Skills.route

    val selectedTab = when {
        route == Screen.Terminal.route -> MainTab.TERMINAL
        route == Screen.Files.route -> MainTab.FILES
        route == Screen.Skills.route -> MainTab.SKILLS
        route == Screen.Settings.route -> MainTab.SETTINGS
        else -> MainTab.CHAT
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (showBottomBar) {
                MainBottomBar(
                    selected = selectedTab,
                    onSelect = { tab ->
                        val target = when (tab) {
                            MainTab.CHAT -> Screen.Chat.routeWithSession()
                            MainTab.TERMINAL -> Screen.Terminal.route
                            MainTab.FILES -> Screen.Files.route
                            MainTab.SKILLS -> Screen.Skills.route
                            MainTab.SETTINGS -> Screen.Settings.route
                        }
                        navController.navigate(target) { launchSingleTop = true }
                    }
                )
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Pairing.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Pairing.route) {
                PairingScreen(onPaired = {
                    onPaired?.invoke()
                    navController.navigate(Screen.Chat.routeWithSession()) {
                        popUpTo(Screen.Pairing.route) { inclusive = true }
                    }
                })
            }
            composable(Screen.Sessions.route) {
                SessionListScreen(
                    onSelect = { sessionId ->
                        val target = Screen.Chat.routeWithSession(sessionId)
                        navController.navigate(target) { launchSingleTop = true }
                    },
                    onResume = { sessionId ->
                        val target = Screen.Chat.routeWithSession("__resume__:$sessionId")
                        navController.navigate(target) { launchSingleTop = true }
                    }
                )
            }
            composable(
                Screen.Chat.route,
                arguments = listOf(navArgument("sessionId") { nullable = true; defaultValue = null })
            ) { entry ->
                ChatScreen(
                    onNavigateSessions = { navController.navigate(Screen.Sessions.route) },
                    onNavigateFiles = { navController.navigate(Screen.Files.route) },
                    onNavigateTerminal = { navController.navigate(Screen.Terminal.route) },
                    onNewSession = {
                        navController.navigate(Screen.Chat.routeWithSession("__new__")) {
                            launchSingleTop = true
                        }
                    },
                    requestedSessionId = entry.arguments?.getString("sessionId")
                )
            }
            composable(Screen.Terminal.route) {
                TerminalScreen()
            }
            composable(Screen.Files.route) {
                FileManagerScreen(
                    onBack = { navController.popBackStack() },
                    onNavigateGit = { navController.navigate(Screen.Git.route) }
                )
            }
            composable(Screen.Git.route) {
                GitScreen(onBack = { navController.popBackStack() })
            }
            composable(Screen.Skills.route) {
                SkillsScreen(onBack = { navController.popBackStack() })
            }
            composable(Screen.Settings.route) {
                SettingsScreen(
                    onUnpaired = {
                        navController.navigate(Screen.Pairing.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                )
            }
        }
    }
}

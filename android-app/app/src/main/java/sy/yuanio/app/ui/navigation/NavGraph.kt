package sy.yuanio.app.ui.navigation

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
import sy.yuanio.app.ui.screen.EnvironmentScreen
import sy.yuanio.app.ui.screen.HomeScreen
import sy.yuanio.app.ui.screen.PairingScreen
import sy.yuanio.app.ui.screen.ResultCenterScreen
import sy.yuanio.app.ui.screen.ApprovalInboxScreen
import sy.yuanio.app.ui.screen.ChatScreen
import sy.yuanio.app.ui.screen.SettingsScreen
import sy.yuanio.app.ui.screen.SessionListScreen
import sy.yuanio.app.ui.screen.TaskCenterScreen
import sy.yuanio.app.ui.screen.FileManagerScreen
import sy.yuanio.app.ui.screen.TerminalScreen
import sy.yuanio.app.ui.screen.GitScreen
import sy.yuanio.app.ui.screen.SkillsScreen
import sy.yuanio.app.ui.component.MainBottomBar
import sy.yuanio.app.ui.component.MainTab

@Composable
fun YuanioNavGraph(
    navController: NavHostController,
    onPaired: (() -> Unit)? = null,
    startPaired: Boolean = false,
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val route = navBackStackEntry?.destination?.route ?: ""

    val showBottomBar = route == Screen.Home.route
            || route.startsWith("chat")
            || route == Screen.Environment.route
            || route == Screen.Sessions.route
            || route == Screen.Settings.route
            || route == Screen.Terminal.route
            || route == Screen.Files.route
            || route == Screen.Git.route
            || route == Screen.Tasks.route
            || route == Screen.Approvals.route
            || route == Screen.Results.route
            || route == Screen.Skills.route

    val selectedTab = when {
        route == Screen.Home.route -> MainTab.HOME
        route == Screen.Tasks.route -> MainTab.HOME
        route == Screen.Approvals.route -> MainTab.HOME
        route == Screen.Results.route -> MainTab.HOME
        route == Screen.Terminal.route -> MainTab.TERMINAL
        route == Screen.Environment.route -> MainTab.ENVIRONMENT
        route == Screen.Settings.route -> MainTab.SETTINGS
        else -> MainTab.SESSIONS
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (showBottomBar) {
                MainBottomBar(
                    selected = selectedTab,
                    onSelect = { tab ->
                        val target = when (tab) {
                            MainTab.HOME -> Screen.Home.route
                            MainTab.SESSIONS -> Screen.Sessions.route
                            MainTab.TERMINAL -> Screen.Terminal.route
                            MainTab.ENVIRONMENT -> Screen.Environment.route
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
            startDestination = if (startPaired) Screen.Home.route else Screen.Pairing.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Pairing.route) {
                PairingScreen(onPaired = {
                    onPaired?.invoke()
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Pairing.route) { inclusive = true }
                    }
                })
            }
            composable(Screen.Home.route) {
                HomeScreen(
                    onOpenCurrentSession = { sessionId ->
                        if (sessionId.isNullOrBlank()) {
                            navController.navigate(Screen.Sessions.route) { launchSingleTop = true }
                        } else {
                            navController.navigate(Screen.Chat.routeWithSession(sessionId)) { launchSingleTop = true }
                        }
                    },
                    onOpenSessions = { navController.navigate(Screen.Sessions.route) { launchSingleTop = true } },
                    onOpenTerminal = { navController.navigate(Screen.Terminal.route) { launchSingleTop = true } },
                    onOpenEnvironment = { navController.navigate(Screen.Environment.route) { launchSingleTop = true } },
                    onOpenFiles = { navController.navigate(Screen.Files.routeWithContext()) { launchSingleTop = true } },
                    onOpenSkills = { navController.navigate(Screen.Skills.route) { launchSingleTop = true } },
                    onOpenTasks = { navController.navigate(Screen.Tasks.route) { launchSingleTop = true } },
                    onOpenTaskSummary = { focusKind, taskId ->
                        val focus = when (focusKind) {
                            sy.yuanio.app.ui.screen.TaskRefreshFocusKind.LATEST_SUMMARY -> "latest"
                            sy.yuanio.app.ui.screen.TaskRefreshFocusKind.RUNNING_TASK -> "running"
                            sy.yuanio.app.ui.screen.TaskRefreshFocusKind.QUEUED_TASK -> "queued"
                            sy.yuanio.app.ui.screen.TaskRefreshFocusKind.NONE -> ""
                        }
                        val target = if (focus.isBlank()) Screen.Tasks.route else Screen.Tasks.routeWithFocus(focus, taskId)
                        navController.navigate(target) { launchSingleTop = true }
                    },
                    onOpenApprovals = { navController.navigate(Screen.Approvals.route) { launchSingleTop = true } },
                    onOpenTaskDetail = { taskId ->
                        navController.navigate(Screen.Chat.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    onOpenResults = {
                        navController.navigate(Screen.Results.routeWithContext()) { launchSingleTop = true }
                    },
                    onOpenArtifactCenter = {
                        navController.navigate(
                            Screen.Results.routeWithContext(mode = sy.yuanio.app.ui.screen.ResultCenterMode.ARTIFACTS.routeValue)
                        ) { launchSingleTop = true }
                    },
                    onOpenResultDetail = { taskId ->
                        navController.navigate(Screen.Results.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    onOpenApprovalDetail = { approvalId ->
                        navController.navigate(Screen.Approvals.routeWithApproval(approvalId)) { launchSingleTop = true }
                    },
                )
            }
            composable(Screen.Environment.route) {
                EnvironmentScreen(
                    onOpenSessions = { navController.navigate(Screen.Sessions.route) { launchSingleTop = true } },
                    onOpenSettings = { navController.navigate(Screen.Settings.route) { launchSingleTop = true } },
                )
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
                arguments = listOf(
                    navArgument("sessionId") { nullable = true; defaultValue = null },
                    navArgument("taskId") { nullable = true; defaultValue = null },
                )
            ) { entry ->
                ChatScreen(
                    onNavigateSessions = { navController.navigate(Screen.Sessions.route) },
                    onNavigateFiles = { navController.navigate(Screen.Files.routeWithContext()) },
                    onNavigateTerminal = { navController.navigate(Screen.Terminal.route) },
                    onNewSession = {
                        navController.navigate(Screen.Chat.routeWithSession("__new__")) {
                            launchSingleTop = true
                        }
                    },
                    requestedSessionId = entry.arguments?.getString("sessionId"),
                    requestedTaskId = entry.arguments?.getString("taskId"),
                )
            }
            composable(Screen.Terminal.route) {
                TerminalScreen()
            }
            composable(
                Screen.Tasks.route,
                arguments = listOf(navArgument("focus") { nullable = true; defaultValue = null }, navArgument("taskId") { nullable = true; defaultValue = null })
            ) { entry ->
                TaskCenterScreen(
                    onBack = { navController.popBackStack() },
                    onOpenTaskDetail = { taskId ->
                        navController.navigate(Screen.Chat.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    onOpenTaskResult = { taskId ->
                        navController.navigate(Screen.Results.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    onOpenHome = { navController.navigate(Screen.Home.route) { launchSingleTop = true } },
                    onOpenChat = { navController.navigate(Screen.Chat.routeWithSession()) { launchSingleTop = true } },
                    requestedFocus = entry.arguments?.getString("focus"),
                    requestedTaskId = entry.arguments?.getString("taskId"),
                )
            }
            composable(
                Screen.Approvals.route,
                arguments = listOf(navArgument("approvalId") { nullable = true; defaultValue = null })
            ) { entry ->
                ApprovalInboxScreen(
                    onBack = { navController.popBackStack() },
                    onOpenHome = { navController.navigate(Screen.Home.route) { launchSingleTop = true } },
                    onOpenChat = { navController.navigate(Screen.Chat.routeWithSession()) { launchSingleTop = true } },
                    onOpenResultDetail = { taskId ->
                        navController.navigate(Screen.Results.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    requestedApprovalId = entry.arguments?.getString("approvalId"),
                )
            }
            composable(
                Screen.Results.route,
                arguments = listOf(
                    navArgument("taskId") { nullable = true; defaultValue = null },
                    navArgument("mode") { nullable = true; defaultValue = null },
                )
            ) { entry ->
                ResultCenterScreen(
                    onBack = { navController.popBackStack() },
                    onOpenTaskDetail = { taskId ->
                        navController.navigate(Screen.Chat.routeWithTask(taskId)) { launchSingleTop = true }
                    },
                    onOpenFiles = { query, taskId ->
                        navController.navigate(Screen.Files.routeWithContext(query = query, taskId = taskId)) { launchSingleTop = true }
                    },
                    onOpenGit = { tab, taskId ->
                        navController.navigate(Screen.Git.routeWithContext(tab = tab, taskId = taskId)) { launchSingleTop = true }
                    },
                    onOpenArtifactOrigin = { sessionId, taskId ->
                        navController.navigate(Screen.Chat.routeWithContext(sessionId = sessionId, taskId = taskId)) { launchSingleTop = true }
                    },
                    onOpenHome = { navController.navigate(Screen.Home.route) { launchSingleTop = true } },
                    requestedTaskId = entry.arguments?.getString("taskId"),
                    requestedMode = entry.arguments?.getString("mode"),
                )
            }
            composable(
                Screen.Files.route,
                arguments = listOf(
                    navArgument("query") { nullable = true; defaultValue = null },
                    navArgument("taskId") { nullable = true; defaultValue = null },
                )
            ) { entry ->
                FileManagerScreen(
                    onBack = { navController.popBackStack() },
                    onNavigateGit = { tab, taskId ->
                        navController.navigate(Screen.Git.routeWithContext(tab = tab, taskId = taskId)) { launchSingleTop = true }
                    },
                    requestedQuery = entry.arguments?.getString("query"),
                    requestedTaskId = entry.arguments?.getString("taskId"),
                )
            }
            composable(
                Screen.Git.route,
                arguments = listOf(
                    navArgument("tab") { nullable = true; defaultValue = null },
                    navArgument("taskId") { nullable = true; defaultValue = null },
                )
            ) { entry ->
                GitScreen(
                    onBack = { navController.popBackStack() },
                    requestedTab = entry.arguments?.getString("tab"),
                    requestedTaskId = entry.arguments?.getString("taskId"),
                )
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


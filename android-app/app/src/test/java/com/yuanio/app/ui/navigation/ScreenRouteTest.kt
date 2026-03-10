package com.yuanio.app.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenRouteTest {

    @Test
    fun `Chat routeWithTask should encode taskId into optional query`() {
        assertEquals(
            "chat?taskId=task_123%2Falpha",
            Screen.Chat.routeWithTask("task_123/alpha")
        )
    }

    @Test
    fun `Chat routeWithSession should keep plain chat when sessionId blank`() {
        assertEquals("chat", Screen.Chat.routeWithSession("  "))
    }

    @Test
    fun `Chat routeWithContext should encode sessionId and taskId`() {
        assertEquals(
            "chat?sessionId=session_42%2Fbeta&taskId=task_123%2Falpha",
            Screen.Chat.routeWithContext(sessionId = "session_42/beta", taskId = "task_123/alpha")
        )
    }

    @Test
    fun `Approvals routeWithApproval should encode approvalId into optional query`() {
        assertEquals(
            "approvals?approvalId=approval_1%2Fdanger",
            Screen.Approvals.routeWithApproval("approval_1/danger")
        )
    }

    @Test
    fun `Tasks routeWithFocusLatest should encode latest focus query`() {
        assertEquals(
            "tasks?focus=latest",
            Screen.Tasks.routeWithFocusLatest()
        )
    }

    @Test
    fun `Tasks routeWithFocus should encode focus and taskId`() {
        assertEquals(
            "tasks?focus=running&taskId=task_running_2",
            Screen.Tasks.routeWithFocus("running", "task_running_2")
        )
    }

    @Test
    fun `Results routeWithTask should encode taskId into optional query`() {
        assertEquals(
            "results?taskId=task_result_1%2Falpha",
            Screen.Results.routeWithTask("task_result_1/alpha")
        )
    }

    @Test
    fun `Results routeWithContext should encode taskId and mode`() {
        assertEquals(
            "results?taskId=task_result_1%2Falpha&mode=artifacts",
            Screen.Results.routeWithContext(taskId = "task_result_1/alpha", mode = "artifacts")
        )
    }

    @Test
    fun `Files routeWithContext should encode query and taskId`() {
        assertEquals(
            "files?query=task_42%2Falpha&taskId=task_42%2Falpha",
            Screen.Files.routeWithContext(query = "task_42/alpha", taskId = "task_42/alpha")
        )
    }

    @Test
    fun `Git routeWithContext should encode tab and taskId`() {
        assertEquals(
            "git?tab=status&taskId=task_git_1%2Fbeta",
            Screen.Git.routeWithContext(tab = "status", taskId = "task_git_1/beta")
        )
    }
}

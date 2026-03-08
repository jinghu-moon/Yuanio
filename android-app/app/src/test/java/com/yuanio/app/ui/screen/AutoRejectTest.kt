package com.yuanio.app.ui.screen

import org.junit.Assert.assertEquals
import org.junit.Test

class ApprovalAutoRejectTest {

    @Test
    fun `低风险审批不应自动拒绝`() {
        assertEquals(null, AutoRejectPolicy.timeoutMs(enabled = true, riskLevel = "low"))
        assertEquals(null, AutoRejectPolicy.timeoutMs(enabled = true, riskLevel = "safe"))
    }

    @Test
    fun `中高风险审批使用分级倒计时`() {
        assertEquals(60_000L, AutoRejectPolicy.timeoutMs(enabled = true, riskLevel = "medium"))
        assertEquals(30_000L, AutoRejectPolicy.timeoutMs(enabled = true, riskLevel = "high"))
        assertEquals(60_000L, AutoRejectPolicy.timeoutMs(enabled = true, riskLevel = "unknown"))
    }

    @Test
    fun `feature flag 关闭时不返回超时`() {
        assertEquals(null, AutoRejectPolicy.timeoutMs(enabled = false, riskLevel = "high"))
    }
}

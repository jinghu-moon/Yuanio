package sy.yuanio.app.ui.screen

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkflowRefreshThrottlerTest {

    @Test
    fun firstRefreshRequestIsAccepted() {
        val throttler = WorkflowRefreshThrottler(cooldownMs = 1200L, nowMs = { 1_000L })

        assertTrue(throttler.tryAcquire())
    }

    @Test
    fun duplicateRequestInsideCooldownIsRejected() {
        var nowMs = 1_000L
        val throttler = WorkflowRefreshThrottler(cooldownMs = 1200L, nowMs = { nowMs })

        assertTrue(throttler.tryAcquire())
        nowMs = 1_500L

        assertFalse(throttler.tryAcquire())
    }

    @Test
    fun requestAfterCooldownIsAcceptedAgain() {
        var nowMs = 1_000L
        val throttler = WorkflowRefreshThrottler(cooldownMs = 1200L, nowMs = { nowMs })

        assertTrue(throttler.tryAcquire())
        nowMs = 2_300L

        assertTrue(throttler.tryAcquire())
    }
}


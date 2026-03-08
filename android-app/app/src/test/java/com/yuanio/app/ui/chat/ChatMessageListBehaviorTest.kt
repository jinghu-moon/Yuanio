package com.yuanio.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatMessageListBehaviorTest {

    @Test
    fun 接近底部时应保持自动滚动() {
        assertTrue(
            shouldAutoScrollToBottom(
                previousTotalItems = 20,
                lastVisibleIndex = 18,
                newTotalItems = 21,
            )
        )
    }

    @Test
    fun 离开底部时应累计未读消息数() {
        assertFalse(
            shouldAutoScrollToBottom(
                previousTotalItems = 20,
                lastVisibleIndex = 10,
                newTotalItems = 23,
            )
        )
        assertEquals(
            3,
            accumulateUnreadMessageCount(
                previousTotalItems = 20,
                newTotalItems = 23,
                lastVisibleIndex = 10,
                previousUnreadCount = 0,
            )
        )
    }

    @Test
    fun 没有新增消息时保留已有未读数() {
        assertEquals(
            2,
            accumulateUnreadMessageCount(
                previousTotalItems = 20,
                newTotalItems = 20,
                lastVisibleIndex = 10,
                previousUnreadCount = 2,
            )
        )
    }
}

package com.yuanio.app.ui.screen

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatSearchQueryDebounceTest {

    @Test
    fun 快速输入时只应发出最后一次查询() = runBlocking {
        val values = flow {
            emit("h")
            delay(5)
            emit("he")
            delay(5)
            emit("hello")
        }.debouncedSearchQuery(20).toList()

        assertEquals(listOf("hello"), values)
    }

    @Test
    fun 清空查询时应立即生效() = runBlocking {
        val values = flow {
            emit("hello")
            delay(30)
            emit("")
        }.debouncedSearchQuery(20).toList()

        assertEquals(listOf("hello", ""), values)
    }
}

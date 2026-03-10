package com.yuanio.app.ui.component

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamingMarkdownSanitizerTest {
    @Test
    fun `sanitizes unclosed code fence by appending closing fence`() {
        val input = "```kt\nval x = 1"

        val output = sanitizeStreamingMarkdown(input)

        assertEquals("```kt\nval x = 1\n```", output)
    }

    @Test
    fun `sanitizes unclosed inline code by appending backtick`() {
        val input = "use `inline code"

        val output = sanitizeStreamingMarkdown(input)

        assertEquals("use `inline code`", output)
    }

    @Test
    fun `sanitizes unclosed bold by appending double stars`() {
        val input = "this is **bold"

        val output = sanitizeStreamingMarkdown(input)

        assertEquals("this is **bold**", output)
    }

    @Test
    fun `balanced markdown is returned unchanged`() {
        val input = "**bold** and `code`"

        val output = sanitizeStreamingMarkdown(input)

        assertEquals(input, output)
    }
}

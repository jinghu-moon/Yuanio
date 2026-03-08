package com.yuanio.app.ui.component

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiffViewerTest {

    @Test
    fun `统一 diff 行会被正确分类`() {
        val lines = parseUnifiedDiffLines(
            """
            diff --git a/src/app.ts b/src/app.ts
            @@ -1,2 +1,2 @@
            -const oldValue = 1
            +const newValue = 2
             console.log(newValue)
            """.trimIndent()
        )

        assertEquals(DiffLineKind.META, lines[0].kind)
        assertEquals(DiffLineKind.HUNK, lines[1].kind)
        assertEquals(DiffLineKind.DELETION, lines[2].kind)
        assertEquals(DiffLineKind.ADDITION, lines[3].kind)
        assertEquals(DiffLineKind.CONTEXT, lines[4].kind)
    }

    @Test
    fun `折叠模型会限制可见行数`() {
        val model = buildDiffViewerModel(
            diff = (1..6).joinToString("\n") { "+line-$it" },
            expanded = false,
            collapsedLineCount = 3,
        )

        assertTrue(model.canExpand)
        assertEquals(3, model.visibleLines.size)
        assertEquals(3, model.hiddenLineCount)
    }

    @Test
    fun `统一 diff 探测会忽略普通预览文本`() {
        assertTrue(looksLikeUnifiedDiff("@@ -1 +1 @@\n-old\n+new"))
        assertFalse(looksLikeUnifiedDiff("npm test -- --watch"))
    }
}

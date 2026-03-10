package sy.yuanio.app.ui.component

import androidx.compose.ui.graphics.Color
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BrandIconsTest {

    @Test
    fun `BrandIcon 默认使用资源内建颜色`() {
        assertEquals(Color.Unspecified, BrandIconDefaultTint)
    }

    @Test
    fun `Claude 与 Gemini 图标资源内嵌品牌颜色`() {
        val claude = File("src/main/res/drawable/ic_ai_claude.xml").readText()
        val gemini = File("src/main/res/drawable/ic_ai_gemini.xml").readText()

        assertTrue(claude.contains("#D97757"))
        assertTrue(gemini.contains("#3186FF"))
    }
}


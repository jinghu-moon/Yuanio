package com.yuanio.app.ui.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.yuanio.app.R

enum class Brand { CLAUDE, ANTHROPIC, OPENAI, GEMINI }

enum class ActionGlyph {
    CHAT,
    TERMINAL,
    FILES,
    SKILLS,
    SETTINGS,
    WARNING,
    CHEVRON_DOWN,
    CHEVRON_UP,
    MORE_VERTICAL,
    X,
    CHECK,
    BOLT,
    ALERT_CIRCLE,
    HOURGLASS,
    PLUS,
}

private val ClaudeBrandColor = Color(0xFFD97757)
private val AnthropicBrandColor = Color(0xFF141413)
private val OpenAIBrandColor = Color(0xFF000000)
private val GeminiBrandColor = Color(0xFF3186FF)
internal val BrandIconDefaultTint: Color = Color.Unspecified

fun agentToBrand(agent: String?): Brand? = when (agent?.lowercase()) {
    "claude" -> Brand.CLAUDE
    "anthropic" -> Brand.ANTHROPIC
    "codex", "openai" -> Brand.OPENAI
    "gemini" -> Brand.GEMINI
    else -> null
}

@Composable
fun brandColor(brand: Brand): Color = when (brand) {
    Brand.CLAUDE -> ClaudeBrandColor
    Brand.ANTHROPIC -> AnthropicBrandColor
    Brand.OPENAI -> OpenAIBrandColor
    Brand.GEMINI -> GeminiBrandColor
}

@Composable
fun agentColor(agent: String): Color = when (agent.lowercase()) {
    "claude" -> ClaudeBrandColor
    "anthropic" -> AnthropicBrandColor
    "codex", "openai" -> OpenAIBrandColor
    "gemini" -> GeminiBrandColor
    else -> MaterialTheme.colorScheme.onSurface
}

fun brandLabel(brand: Brand): String = when (brand) {
    Brand.CLAUDE -> "Claude"
    Brand.ANTHROPIC -> "Anthropic"
    Brand.OPENAI -> "OpenAI"
    Brand.GEMINI -> "Gemini"
}

fun brandIconRes(brand: Brand): Int = when (brand) {
    Brand.CLAUDE -> R.drawable.ic_ai_claude
    Brand.ANTHROPIC -> R.drawable.ic_ai_anthropic
    Brand.OPENAI -> R.drawable.ic_ai_openai
    Brand.GEMINI -> R.drawable.ic_ai_gemini
}

fun actionGlyphRes(glyph: ActionGlyph): Int = when (glyph) {
    ActionGlyph.CHAT -> R.drawable.ic_tb_message_circle
    ActionGlyph.TERMINAL -> R.drawable.ic_tb_terminal_2
    ActionGlyph.FILES -> R.drawable.ic_tb_folder
    ActionGlyph.SKILLS -> R.drawable.ic_tb_sparkles
    ActionGlyph.SETTINGS -> R.drawable.ic_tb_settings
    ActionGlyph.WARNING -> R.drawable.ic_tb_alert_triangle
    ActionGlyph.CHEVRON_DOWN -> R.drawable.ic_tb_chevron_down
    ActionGlyph.CHEVRON_UP -> R.drawable.ic_tb_chevron_up
    ActionGlyph.MORE_VERTICAL -> R.drawable.ic_tb_dots_vertical
    ActionGlyph.X -> R.drawable.ic_tb_x
    ActionGlyph.CHECK -> R.drawable.ic_tb_check
    ActionGlyph.BOLT -> R.drawable.ic_tb_bolt
    ActionGlyph.ALERT_CIRCLE -> R.drawable.ic_tb_alert_circle
    ActionGlyph.HOURGLASS -> R.drawable.ic_tb_hourglass_empty
    ActionGlyph.PLUS -> R.drawable.ic_tb_plus
}

@Composable
fun BrandIcon(
    brand: Brand,
    modifier: Modifier = Modifier,
    iconTint: Color = BrandIconDefaultTint,
) {
    Icon(
        painter = painterResource(brandIconRes(brand)),
        contentDescription = brandLabel(brand),
        modifier = modifier,
        tint = iconTint,
    )
}

@Composable
fun ActionGlyphIcon(
    glyph: ActionGlyph,
    modifier: Modifier = Modifier,
    iconTint: Color = MaterialTheme.colorScheme.onSurface,
    contentDescription: String? = null,
) {
    Icon(
        painter = painterResource(actionGlyphRes(glyph)),
        contentDescription = contentDescription,
        modifier = modifier,
        tint = iconTint,
    )
}

@Composable
fun BrandChipRow(
    modifier: Modifier = Modifier,
    brands: List<Brand> = listOf(Brand.CLAUDE, Brand.ANTHROPIC, Brand.OPENAI, Brand.GEMINI),
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(brands) { brand ->
            AssistChip(
                onClick = {},
                label = { Text(brandLabel(brand)) },
                leadingIcon = {
                    BrandIcon(
                        brand = brand,
                        modifier = Modifier.size(16.dp),
                    )
                }
            )
        }
    }
}

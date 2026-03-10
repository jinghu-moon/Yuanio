package sy.yuanio.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Geist 主题：中性色为主，功能色点缀。
 * 参考：`refer/color.txt`
 */
private object GeistNeutral {
    val Gray050 = Color(0xFFFAFAFA)
    val White = Color(0xFFFFFFFF)
    val Black = Color(0xFF000000)
    val Gray100 = Color(0xFFF2F2F2)
    val Gray200 = Color(0xFFEBEBEB)
    val Gray300 = Color(0xFFE6E6E6)
    val Gray500 = Color(0xFFC9C9C9)
    val Gray600 = Color(0xFFA8A8A8)
    val Gray700 = Color(0xFF8F8F8F)
    val Gray800 = Color(0xFF7D7D7D)
    val Gray900 = Color(0xFF666666)
    val Gray1000 = Color(0xFF171717)
}

private object GeistFunctional {
    val Blue700 = Color(0xFF0070F3)
    val Blue500 = Color(0xFF3291FF)
    val Red700 = Color(0xFFE5484D)
    val Red500 = Color(0xFFFF6369)
    val Amber700 = Color(0xFFF5A524)
    val Amber500 = Color(0xFFF7B955)
    val Green700 = Color(0xFF2E8E4E)
    val Green500 = Color(0xFF4FB46B)
}

private val LightColors = lightColorScheme(
    primary = GeistNeutral.Gray1000,
    onPrimary = GeistNeutral.White,
    primaryContainer = GeistNeutral.Gray100,
    onPrimaryContainer = GeistNeutral.Gray1000,
    secondary = GeistNeutral.Gray900,
    onSecondary = GeistNeutral.White,
    secondaryContainer = GeistNeutral.Gray200,
    onSecondaryContainer = GeistNeutral.Gray1000,
    tertiary = GeistFunctional.Blue700,
    onTertiary = GeistNeutral.White,
    tertiaryContainer = GeistFunctional.Blue700.copy(alpha = 0.12f),
    onTertiaryContainer = GeistFunctional.Blue700,
    error = GeistFunctional.Red700,
    onError = GeistNeutral.White,
    errorContainer = GeistFunctional.Red700.copy(alpha = 0.12f),
    onErrorContainer = GeistFunctional.Red700,
    background = GeistNeutral.Gray050,
    onBackground = GeistNeutral.Gray1000,
    surface = GeistNeutral.White,
    onSurface = GeistNeutral.Gray1000,
    surfaceVariant = GeistNeutral.Gray100,
    onSurfaceVariant = GeistNeutral.Gray800,
    outline = GeistNeutral.Gray700,
    outlineVariant = GeistNeutral.Gray300,
    inverseSurface = GeistNeutral.Gray1000,
    inverseOnSurface = GeistNeutral.White,
    inversePrimary = GeistNeutral.White,
    surfaceTint = GeistNeutral.Gray1000,
    surfaceBright = GeistNeutral.White,
    surfaceDim = GeistNeutral.Gray100,
    surfaceContainerLowest = GeistNeutral.White,
    surfaceContainerLow = GeistNeutral.Gray100,
    surfaceContainer = GeistNeutral.Gray100,
    surfaceContainerHigh = GeistNeutral.Gray200,
    surfaceContainerHighest = GeistNeutral.Gray300,
    primaryFixed = GeistNeutral.Gray1000,
    onPrimaryFixed = GeistNeutral.White,
    primaryFixedDim = GeistNeutral.Gray900,
    onPrimaryFixedVariant = GeistNeutral.Gray100,
    secondaryFixed = GeistNeutral.Gray900,
    onSecondaryFixed = GeistNeutral.White,
    secondaryFixedDim = GeistNeutral.Gray800,
    onSecondaryFixedVariant = GeistNeutral.Gray200,
    tertiaryFixed = GeistFunctional.Blue700,
    onTertiaryFixed = GeistNeutral.White,
    tertiaryFixedDim = GeistFunctional.Blue500,
    onTertiaryFixedVariant = GeistNeutral.Gray100,
    scrim = GeistNeutral.Black.copy(alpha = 0.45f),
)

private val DarkColors = darkColorScheme(
    primary = GeistNeutral.White,
    onPrimary = GeistNeutral.Gray1000,
    primaryContainer = GeistNeutral.Gray900,
    onPrimaryContainer = GeistNeutral.White,
    secondary = GeistNeutral.Gray600,
    onSecondary = GeistNeutral.Gray1000,
    secondaryContainer = GeistNeutral.Gray900,
    onSecondaryContainer = GeistNeutral.Gray200,
    tertiary = GeistFunctional.Blue500,
    onTertiary = GeistNeutral.Gray1000,
    tertiaryContainer = GeistFunctional.Blue500.copy(alpha = 0.22f),
    onTertiaryContainer = GeistFunctional.Blue500,
    error = GeistFunctional.Red500,
    onError = GeistNeutral.Gray1000,
    errorContainer = GeistFunctional.Red500.copy(alpha = 0.22f),
    onErrorContainer = GeistFunctional.Red500,
    background = GeistNeutral.Black,
    onBackground = GeistNeutral.White,
    surface = GeistNeutral.Gray1000,
    onSurface = GeistNeutral.White,
    surfaceVariant = GeistNeutral.Gray900,
    onSurfaceVariant = GeistNeutral.Gray500,
    outline = GeistNeutral.Gray700,
    outlineVariant = GeistNeutral.Gray900,
    inverseSurface = GeistNeutral.White,
    inverseOnSurface = GeistNeutral.Gray1000,
    inversePrimary = GeistNeutral.Gray1000,
    surfaceTint = GeistNeutral.White,
    surfaceBright = GeistNeutral.Gray900,
    surfaceDim = GeistNeutral.Black,
    surfaceContainerLowest = GeistNeutral.Black,
    surfaceContainerLow = GeistNeutral.Gray1000,
    surfaceContainer = GeistNeutral.Gray1000,
    surfaceContainerHigh = GeistNeutral.Gray900,
    surfaceContainerHighest = GeistNeutral.Gray800,
    primaryFixed = GeistNeutral.White,
    onPrimaryFixed = GeistNeutral.Gray1000,
    primaryFixedDim = GeistNeutral.Gray300,
    onPrimaryFixedVariant = GeistNeutral.Gray800,
    secondaryFixed = GeistNeutral.Gray500,
    onSecondaryFixed = GeistNeutral.Gray1000,
    secondaryFixedDim = GeistNeutral.Gray700,
    onSecondaryFixedVariant = GeistNeutral.Gray200,
    tertiaryFixed = GeistFunctional.Blue500,
    onTertiaryFixed = GeistNeutral.Gray1000,
    tertiaryFixedDim = GeistFunctional.Blue700,
    onTertiaryFixedVariant = GeistNeutral.Gray200,
    scrim = GeistNeutral.Black.copy(alpha = 0.65f),
)

@Immutable
data class YuanioShapes(
    val compact: RoundedCornerShape,
    val panel: RoundedCornerShape,
    val bubble: RoundedCornerShape,
)

@Immutable
data class YuanioSurfaces(
    val subtle: Color,
    val muted: Color,
    val accent: Color,
    val success: Color,
    val warning: Color,
)

@Immutable
data class YuanioColors(
    val agentClaude: Color,
    val agentCodex: Color,
    val agentGemini: Color,
    val connected: Color,
    val disconnected: Color,
    val reconnecting: Color,
    val success: Color,
    val warning: Color,
    val info: Color,
)

private val DefaultYuanioShapes = YuanioShapes(
    compact = RoundedCornerShape(8.dp),
    panel = RoundedCornerShape(12.dp),
    bubble = RoundedCornerShape(16.dp),
)

private val LightYuanioSurfaces = YuanioSurfaces(
    subtle = GeistNeutral.Gray100,
    muted = GeistNeutral.Gray200,
    accent = GeistFunctional.Blue700.copy(alpha = 0.10f),
    success = GeistFunctional.Green700.copy(alpha = 0.10f),
    warning = GeistFunctional.Amber700.copy(alpha = 0.14f),
)

private val DarkYuanioSurfaces = YuanioSurfaces(
    subtle = GeistNeutral.Gray900,
    muted = GeistNeutral.Gray800,
    accent = GeistFunctional.Blue500.copy(alpha = 0.18f),
    success = GeistFunctional.Green500.copy(alpha = 0.18f),
    warning = GeistFunctional.Amber500.copy(alpha = 0.22f),
)

private val LightYuanioColors = YuanioColors(
    agentClaude = GeistFunctional.Amber700,
    agentCodex = GeistFunctional.Green700,
    agentGemini = GeistFunctional.Blue700,
    connected = GeistFunctional.Blue700,
    disconnected = GeistFunctional.Red700,
    reconnecting = GeistFunctional.Amber700,
    success = GeistFunctional.Green700,
    warning = GeistFunctional.Amber700,
    info = GeistFunctional.Blue700,
)

private val DarkYuanioColors = YuanioColors(
    agentClaude = GeistFunctional.Amber500,
    agentCodex = GeistFunctional.Green500,
    agentGemini = GeistFunctional.Blue500,
    connected = GeistFunctional.Blue500,
    disconnected = GeistFunctional.Red500,
    reconnecting = GeistFunctional.Amber500,
    success = GeistFunctional.Green500,
    warning = GeistFunctional.Amber500,
    info = GeistFunctional.Blue500,
)

val LocalYuanioColors = staticCompositionLocalOf { LightYuanioColors }
val LocalYuanioShapes = staticCompositionLocalOf { DefaultYuanioShapes }
val LocalYuanioSurfaces = staticCompositionLocalOf { LightYuanioSurfaces }

@Composable
fun YuanioTheme(content: @Composable () -> Unit) {
    val mode by ThemePreference.mode.collectAsState()
    val dark = when (mode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }
    val vibeCastColors = if (dark) DarkYuanioColors else LightYuanioColors
    val vibeCastSurfaces = if (dark) DarkYuanioSurfaces else LightYuanioSurfaces

    CompositionLocalProvider(
        LocalYuanioColors provides vibeCastColors,
        LocalYuanioShapes provides DefaultYuanioShapes,
        LocalYuanioSurfaces provides vibeCastSurfaces,
    ) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            content = content,
        )
    }
}


package sy.yuanio.app.ui.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import org.connectbot.terminal.TerminalEmulator
import org.connectbot.terminal.TerminalEmulatorFactory

/**
 * termlib 薄封装：统一管理 emulator 生命周期、输入/输出桥接、主题映射。
 */
class TerminalEmulatorManager(
    val ptyId: String,
    initialRows: Int = 24,
    initialCols: Int = 80,
    initialColorScheme: TerminalColorScheme,
    private val onInput: (ByteArray) -> Unit,
    private val onResize: (cols: Int, rows: Int) -> Unit,
) {
    private val inputChannel = Channel<ByteArray>(Channel.BUFFERED)
    private var inputJob: Job? = null

    val emulator: TerminalEmulator = TerminalEmulatorFactory.create(
        initialRows = initialRows,
        initialCols = initialCols,
        defaultForeground = initialColorScheme.foreground,
        defaultBackground = initialColorScheme.background,
        onKeyboardInput = { data ->
            inputChannel.trySend(data)
        },
        onResize = { dims ->
            onResize(dims.columns, dims.rows)
        }
    )

    init {
        applyColorScheme(initialColorScheme)
    }

    fun collectInput(scope: CoroutineScope) {
        if (inputJob != null) return
        inputJob = scope.launch {
            for (data in inputChannel) {
                onInput(data)
            }
        }
    }

    fun writeOutput(data: String) {
        if (data.isEmpty()) return
        emulator.writeInput(data.toByteArray(Charsets.UTF_8))
    }

    fun writeOutput(data: ByteArray) {
        if (data.isEmpty()) return
        emulator.writeInput(data)
    }

    fun applyColorScheme(colorScheme: TerminalColorScheme) {
        emulator.applyColorScheme(
            colorScheme.ansiColors,
            colorScheme.foreground.toArgb(),
            colorScheme.background.toArgb(),
        )
    }

    /**
     * termlib 版本间选区 API 不稳定，运行时探测可用方法，避免编译期耦合。
     */
    fun getSelectedTextOrNull(): String? {
        val methodNames = listOf("getSelectedText", "getSelectionText", "copySelection")
        for (name in methodNames) {
            val method = emulator.javaClass.methods.firstOrNull { it.name == name && it.parameterCount == 0 }
                ?: continue
            runCatching {
                val value = method.invoke(emulator)
                return (value as? String)?.takeIf { it.isNotBlank() }
            }
        }
        return null
    }

    fun destroy() {
        inputJob?.cancel()
        inputJob = null
        inputChannel.close()

        // 某些 termlib 版本提供了 close()/destroy()，这里做反射兜底释放。
        val lifecycleMethod = emulator.javaClass.methods.firstOrNull {
            (it.name == "close" || it.name == "destroy") && it.parameterCount == 0
        }
        lifecycleMethod?.let { runCatching { it.invoke(emulator) } }
    }
}

data class TerminalColorScheme(
    val name: String = "",
    val foreground: Color,
    val background: Color,
    val cursorColor: Color = foreground,
    val selectionBg: Color = Color(0xFF3E4451),
    val ansiColors: IntArray,
) {
    companion object {
        val DARK = TerminalColorScheme(
            name = "One Dark",
            foreground = Color(0xFFDCDFE4),
            background = Color(0xFF282C34),
            cursorColor = Color(0xFFDCDFE4),
            selectionBg = Color(0xFF3E4451),
            ansiColors = intArrayOf(
                0xFF282C34.toInt(), 0xFFE06C75.toInt(), 0xFF98C379.toInt(), 0xFFE5C07B.toInt(),
                0xFF61AFEF.toInt(), 0xFFC678DD.toInt(), 0xFF56B6C2.toInt(), 0xFFDCDFE4.toInt(),
                0xFF5C6370.toInt(), 0xFFE06C75.toInt(), 0xFF98C379.toInt(), 0xFFE5C07B.toInt(),
                0xFF61AFEF.toInt(), 0xFFC678DD.toInt(), 0xFF56B6C2.toInt(), 0xFFFFFFFF.toInt(),
            )
        )

        val LIGHT = TerminalColorScheme(
            name = "Solarized Light",
            foreground = Color(0xFF383A42),
            background = Color(0xFFFAFAFA),
            cursorColor = Color(0xFF383A42),
            selectionBg = Color(0xFFE8E8E8),
            ansiColors = intArrayOf(
                0xFF383A42.toInt(), 0xFFE45649.toInt(), 0xFF50A14F.toInt(), 0xFFC18401.toInt(),
                0xFF4078F2.toInt(), 0xFFA626A4.toInt(), 0xFF0184BC.toInt(), 0xFFA0A1A7.toInt(),
                0xFF696C77.toInt(), 0xFFE45649.toInt(), 0xFF50A14F.toInt(), 0xFFC18401.toInt(),
                0xFF4078F2.toInt(), 0xFFA626A4.toInt(), 0xFF0184BC.toInt(), 0xFFFFFFFF.toInt(),
            )
        )

        val POWERSHELL = TerminalColorScheme(
            name = "PowerShell",
            foreground = Color(0xFFCCCCCC),
            background = Color(0xFF012456),
            cursorColor = Color(0xFFFFFFFF),
            selectionBg = Color(0xFF1B4F72),
            ansiColors = intArrayOf(
                0xFF000000.toInt(), 0xFF800000.toInt(), 0xFF008000.toInt(), 0xFF808000.toInt(),
                0xFF000080.toInt(), 0xFF800080.toInt(), 0xFF008080.toInt(), 0xFFC0C0C0.toInt(),
                0xFF808080.toInt(), 0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFFFFFF00.toInt(),
                0xFF0000FF.toInt(), 0xFFFF00FF.toInt(), 0xFF00FFFF.toInt(), 0xFFFFFFFF.toInt(),
            )
        )
    }
}


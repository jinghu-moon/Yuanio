package com.yuanio.app.ui.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import org.json.JSONArray
import org.json.JSONObject

/**
 * 缁堢閰嶈壊鏂规绠＄悊鍣細
 * - 棰勭疆 10 濂楀父鐢ㄩ厤鑹诧紙One Dark, Dracula, Solarized, Nord 绛夛級
 * - 鏀寔 JSON 瀵煎叆 Windows Terminal 閰嶈壊鏍煎紡
 * - 姣忎釜 Profile 鍙嫭绔嬬粦瀹氶厤鑹叉柟妗堝悕绉? */
object ColorSchemeManager {

    /** 鍏ㄩ儴宸叉敞鍐岀殑閰嶈壊鏂规锛堥缃?+ 鐢ㄦ埛鑷畾涔夛級 */
    private val schemes = mutableMapOf<String, TerminalColorScheme>()


    /** 鎸夊悕绉拌幏鍙栵紝鎵句笉鍒版椂杩斿洖 One Dark */
    fun get(name: String): TerminalColorScheme =
        schemes[name] ?: schemes[DEFAULT_SCHEME_NAME] ?: BUILTIN_SCHEMES.first()

    /** 鍏ㄩ儴鏂规鍚嶇О鍒楄〃 */
    fun allNames(): List<String> = schemes.keys.toList()

    /** 鍏ㄩ儴鏂规鍒楄〃 */
    fun all(): List<TerminalColorScheme> = schemes.values.toList()

    /** 娉ㄥ唽鑷畾涔夐厤鑹叉柟妗?*/
    fun register(scheme: TerminalColorScheme) {
        schemes[scheme.name] = scheme
    }

    /** 绉婚櫎鑷畾涔夐厤鑹叉柟妗堬紙棰勭疆鏂规涓嶅彲鍒犻櫎锛?*/
    fun remove(name: String) {
        if (BUILTIN_NAMES.contains(name)) return
        schemes.remove(name)
    }

    /**
     * 瀵煎叆 Windows Terminal 鏍煎紡鐨?JSON 閰嶈壊銆?     * 鏍煎紡绀轰緥:
     * {
     *   "name": "My Theme",
     *   "foreground": "#DCDFE4",
     *   "background": "#282C34",
     *   "cursorColor": "#DCDFE4",
     *   "selectionBackground": "#3E4451",
     *   "black": "#282C34", "red": "#E06C75", ...
     * }
     */
    fun importFromJson(json: String): TerminalColorScheme? {
        return try {
            val obj = JSONObject(json)
            val name = obj.optString("name", "Imported")
            // 16 色 ANSI 键名（Windows Terminal 格式）
            val colorKeys = listOf(
                "black", "red", "green", "yellow",
                "blue", "purple", "cyan", "white",
                "brightBlack", "brightRed", "brightGreen", "brightYellow",
                "brightBlue", "brightPurple", "brightCyan", "brightWhite",
            )
            val ansiColors = IntArray(16) { i ->
                parseHexColor(obj.optString(colorKeys[i], "#000000"))
            }
            val scheme = TerminalColorScheme(
                name = name,
                foreground = Color(parseHexColor(obj.optString("foreground", "#DCDFE4"))),
                background = Color(parseHexColor(obj.optString("background", "#282C34"))),
                cursorColor = Color(parseHexColor(obj.optString("cursorColor", "#DCDFE4"))),
                selectionBg = Color(parseHexColor(obj.optString("selectionBackground", "#3E4451"))),
                ansiColors = ansiColors,
            )
            register(scheme)
            scheme
        } catch (e: Exception) {
            null
        }
    }

    /** 灏嗛厤鑹叉柟妗堝鍑轰负 JSON 瀛楃涓?*/
    fun exportToJson(scheme: TerminalColorScheme): String {
        val colorKeys = listOf(
            "black", "red", "green", "yellow",
            "blue", "purple", "cyan", "white",
            "brightBlack", "brightRed", "brightGreen", "brightYellow",
            "brightBlue", "brightPurple", "brightCyan", "brightWhite",
        )
        val obj = JSONObject()
        obj.put("name", scheme.name)
        obj.put("foreground", toHex(scheme.foreground))
        obj.put("background", toHex(scheme.background))
        obj.put("cursorColor", toHex(scheme.cursorColor))
        obj.put("selectionBackground", toHex(scheme.selectionBg))
        colorKeys.forEachIndexed { i, key ->
            obj.put(key, String.format("#%06X", scheme.ansiColors[i] and 0xFFFFFF))
        }
        return obj.toString(2)
    }

    // 鈹€鈹€ 宸ュ叿鍑芥暟 鈹€鈹€

    private fun parseHexColor(hex: String): Int {
        val clean = hex.removePrefix("#")
        return (0xFF000000 or clean.toLong(16)).toInt()
    }

    private fun toHex(color: Color): String =
        String.format("#%06X", color.toArgb() and 0xFFFFFF)

    // 鈹€鈹€ 甯搁噺 鈹€鈹€

    const val DEFAULT_SCHEME_NAME = "One Dark"
    private val BUILTIN_NAMES: Set<String> by lazy { BUILTIN_SCHEMES.map { it.name }.toSet() }

    // 鈹€鈹€ 10 濂楅缃厤鑹?鈹€鈹€

    private val BUILTIN_SCHEMES: List<TerminalColorScheme> = listOf(
        // 1. One Dark
        TerminalColorScheme(
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
            ),
        ),
        // 2. Dracula
        TerminalColorScheme(
            name = "Dracula",
            foreground = Color(0xFFF8F8F2),
            background = Color(0xFF282A36),
            cursorColor = Color(0xFFF8F8F2),
            selectionBg = Color(0xFF44475A),
            ansiColors = intArrayOf(
                0xFF21222C.toInt(), 0xFFFF5555.toInt(), 0xFF50FA7B.toInt(), 0xFFF1FA8C.toInt(),
                0xFF6272A4.toInt(), 0xFFFF79C6.toInt(), 0xFF8BE9FD.toInt(), 0xFFF8F8F2.toInt(),
                0xFF6272A4.toInt(), 0xFFFF6E6E.toInt(), 0xFF69FF94.toInt(), 0xFFFFFFA5.toInt(),
                0xFFD6ACFF.toInt(), 0xFFFF92DF.toInt(), 0xFFA4FFFF.toInt(), 0xFFFFFFFF.toInt(),
            ),
        ),
        // 3. Nord
        TerminalColorScheme(
            name = "Nord",
            foreground = Color(0xFFD8DEE9),
            background = Color(0xFF2E3440),
            cursorColor = Color(0xFFD8DEE9),
            selectionBg = Color(0xFF434C5E),
            ansiColors = intArrayOf(
                0xFF3B4252.toInt(), 0xFFBF616A.toInt(), 0xFFA3BE8C.toInt(), 0xFFEBCB8B.toInt(),
                0xFF81A1C1.toInt(), 0xFFB48EAD.toInt(), 0xFF88C0D0.toInt(), 0xFFE5E9F0.toInt(),
                0xFF4C566A.toInt(), 0xFFBF616A.toInt(), 0xFFA3BE8C.toInt(), 0xFFEBCB8B.toInt(),
                0xFF81A1C1.toInt(), 0xFFB48EAD.toInt(), 0xFF8FBCBB.toInt(), 0xFFECEFF4.toInt(),
            ),
        ),
        // 4. Solarized Dark
        TerminalColorScheme(
            name = "Solarized Dark",
            foreground = Color(0xFF839496),
            background = Color(0xFF002B36),
            cursorColor = Color(0xFF839496),
            selectionBg = Color(0xFF073642),
            ansiColors = intArrayOf(
                0xFF073642.toInt(), 0xFFDC322F.toInt(), 0xFF859900.toInt(), 0xFFB58900.toInt(),
                0xFF268BD2.toInt(), 0xFFD33682.toInt(), 0xFF2AA198.toInt(), 0xFFEEE8D5.toInt(),
                0xFF002B36.toInt(), 0xFFCB4B16.toInt(), 0xFF586E75.toInt(), 0xFF657B83.toInt(),
                0xFF839496.toInt(), 0xFF6C71C4.toInt(), 0xFF93A1A1.toInt(), 0xFFFDF6E3.toInt(),
            ),
        ),
        // 5. Solarized Light
        TerminalColorScheme(
            name = "Solarized Light",
            foreground = Color(0xFF657B83),
            background = Color(0xFFFDF6E3),
            cursorColor = Color(0xFF657B83),
            selectionBg = Color(0xFFEEE8D5),
            ansiColors = intArrayOf(
                0xFFEEE8D5.toInt(), 0xFFDC322F.toInt(), 0xFF859900.toInt(), 0xFFB58900.toInt(),
                0xFF268BD2.toInt(), 0xFFD33682.toInt(), 0xFF2AA198.toInt(), 0xFF073642.toInt(),
                0xFFFDF6E3.toInt(), 0xFFCB4B16.toInt(), 0xFF93A1A1.toInt(), 0xFF839496.toInt(),
                0xFF657B83.toInt(), 0xFF6C71C4.toInt(), 0xFF586E75.toInt(), 0xFF002B36.toInt(),
            ),
        ),
        // 6. Gruvbox Dark
        TerminalColorScheme(
            name = "Gruvbox Dark",
            foreground = Color(0xFFEBDBB2),
            background = Color(0xFF282828),
            cursorColor = Color(0xFFEBDBB2),
            selectionBg = Color(0xFF3C3836),
            ansiColors = intArrayOf(
                0xFF282828.toInt(), 0xFFCC241D.toInt(), 0xFF98971A.toInt(), 0xFFD79921.toInt(),
                0xFF458588.toInt(), 0xFFB16286.toInt(), 0xFF689D6A.toInt(), 0xFFA89984.toInt(),
                0xFF928374.toInt(), 0xFFFB4934.toInt(), 0xFFB8BB26.toInt(), 0xFFFABD2F.toInt(),
                0xFF83A598.toInt(), 0xFFD3869B.toInt(), 0xFF8EC07C.toInt(), 0xFFEBDBB2.toInt(),
            ),
        ),
        // 7. Tokyo Night
        TerminalColorScheme(
            name = "Tokyo Night",
            foreground = Color(0xFFC0CAF5),
            background = Color(0xFF1A1B26),
            cursorColor = Color(0xFFC0CAF5),
            selectionBg = Color(0xFF33467C),
            ansiColors = intArrayOf(
                0xFF15161E.toInt(), 0xFFF7768E.toInt(), 0xFF9ECE6A.toInt(), 0xFFE0AF68.toInt(),
                0xFF7AA2F7.toInt(), 0xFFBB9AF7.toInt(), 0xFF7DCFFF.toInt(), 0xFFA9B1D6.toInt(),
                0xFF414868.toInt(), 0xFFF7768E.toInt(), 0xFF9ECE6A.toInt(), 0xFFE0AF68.toInt(),
                0xFF7AA2F7.toInt(), 0xFFBB9AF7.toInt(), 0xFF7DCFFF.toInt(), 0xFFC0CAF5.toInt(),
            ),
        ),
        // 8. Catppuccin Mocha
        TerminalColorScheme(
            name = "Catppuccin Mocha",
            foreground = Color(0xFFCDD6F4),
            background = Color(0xFF1E1E2E),
            cursorColor = Color(0xFFF5E0DC),
            selectionBg = Color(0xFF45475A),
            ansiColors = intArrayOf(
                0xFF45475A.toInt(), 0xFFF38BA8.toInt(), 0xFFA6E3A1.toInt(), 0xFFF9E2AF.toInt(),
                0xFF89B4FA.toInt(), 0xFFF5C2E7.toInt(), 0xFF94E2D5.toInt(), 0xFFBAC2DE.toInt(),
                0xFF585B70.toInt(), 0xFFF38BA8.toInt(), 0xFFA6E3A1.toInt(), 0xFFF9E2AF.toInt(),
                0xFF89B4FA.toInt(), 0xFFF5C2E7.toInt(), 0xFF94E2D5.toInt(), 0xFFA6ADC8.toInt(),
            ),
        ),
        // 9. Campbell (Windows Terminal 榛樿)
        TerminalColorScheme(
            name = "Campbell",
            foreground = Color(0xFFCCCCCC),
            background = Color(0xFF0C0C0C),
            cursorColor = Color(0xFFFFFFFF),
            selectionBg = Color(0xFF264F78),
            ansiColors = intArrayOf(
                0xFF0C0C0C.toInt(), 0xFFC50F1F.toInt(), 0xFF13A10E.toInt(), 0xFFC19C00.toInt(),
                0xFF0037DA.toInt(), 0xFF881798.toInt(), 0xFF3A96DD.toInt(), 0xFFCCCCCC.toInt(),
                0xFF767676.toInt(), 0xFFE74856.toInt(), 0xFF16C60C.toInt(), 0xFFF9F1A5.toInt(),
                0xFF3B78FF.toInt(), 0xFFB4009E.toInt(), 0xFF61D6D6.toInt(), 0xFFF2F2F2.toInt(),
            ),
        ),
        // 10. PowerShell
        TerminalColorScheme(
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
            ),
        ),
    )
    init {
        // 娉ㄥ唽鍏ㄩ儴棰勭疆鏂规
        BUILTIN_SCHEMES.forEach { schemes[it.name] = it }
    }
}


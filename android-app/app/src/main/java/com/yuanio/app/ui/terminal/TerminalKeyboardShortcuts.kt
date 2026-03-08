package com.yuanio.app.ui.terminal

import android.view.KeyEvent
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type

/**
 * 终端快捷键动作
 */
enum class TerminalAction {
    NEW_TAB,
    CLOSE_TAB,
    NEXT_TAB,
    PREV_TAB,
    SPLIT_VERTICAL,
    SPLIT_HORIZONTAL,
    CLOSE_PANE,
    COMMAND_PALETTE,
    TOGGLE_SEARCH,
    COPY,
    PASTE,
    CLEAR_SCREEN,
    FONT_INCREASE,
    FONT_DECREASE,
    RESET_TERMINAL,
}

/**
 * 快捷键绑定定义
 */
data class KeyBinding(
    val action: TerminalAction,
    val key: Key,
    val ctrl: Boolean = false,
    val shift: Boolean = false,
    val description: String = "",
)

/**
 * 终端外接键盘快捷键管理器
 *
 * 类似 Windows Terminal 的快捷键映射：
 * - Ctrl+Shift+T → 新建标签
 * - Ctrl+Shift+W → 关闭标签
 * - Ctrl+Tab / Ctrl+Shift+Tab → 切换标签
 * - Ctrl+Shift+P → 命令面板
 * - Ctrl+Shift+D → 垂直分屏
 * - Ctrl+Shift+E → 水平分屏
 * - Ctrl+Shift+F → 搜索
 * - 等等
 *
 * 在 TerminalScreen 中通过 Modifier.onPreviewKeyEvent 接入。
 */
object TerminalKeyboardShortcuts {

    /** 默认快捷键绑定表 */
    val defaultBindings: List<KeyBinding> = listOf(
        // Tab 管理
        KeyBinding(TerminalAction.NEW_TAB, Key.T, ctrl = true, shift = true,
            description = "新建标签页"),
        KeyBinding(TerminalAction.CLOSE_TAB, Key.W, ctrl = true, shift = true,
            description = "关闭当前标签页"),
        KeyBinding(TerminalAction.NEXT_TAB, Key.Tab, ctrl = true,
            description = "切换到下一个标签"),
        KeyBinding(TerminalAction.PREV_TAB, Key.Tab, ctrl = true, shift = true,
            description = "切换到上一个标签"),

        // 分屏
        KeyBinding(TerminalAction.SPLIT_VERTICAL, Key.D, ctrl = true, shift = true,
            description = "垂直分屏"),
        KeyBinding(TerminalAction.SPLIT_HORIZONTAL, Key.E, ctrl = true, shift = true,
            description = "水平分屏"),
        KeyBinding(TerminalAction.CLOSE_PANE, Key.W, ctrl = true,
            description = "关闭当前面板"),

        // 命令面板与搜索
        KeyBinding(TerminalAction.COMMAND_PALETTE, Key.P, ctrl = true, shift = true,
            description = "打开命令面板"),
        KeyBinding(TerminalAction.TOGGLE_SEARCH, Key.F, ctrl = true, shift = true,
            description = "搜索终端内容"),

        // 编辑
        KeyBinding(TerminalAction.COPY, Key.C, ctrl = true, shift = true,
            description = "复制选中内容"),
        KeyBinding(TerminalAction.PASTE, Key.V, ctrl = true, shift = true,
            description = "粘贴"),

        // 显示
        KeyBinding(TerminalAction.CLEAR_SCREEN, Key.K, ctrl = true, shift = true,
            description = "清屏"),
        KeyBinding(TerminalAction.FONT_INCREASE, Key.Equals, ctrl = true,
            description = "增大字号"),
        KeyBinding(TerminalAction.FONT_DECREASE, Key.Minus, ctrl = true,
            description = "减小字号"),
        KeyBinding(TerminalAction.RESET_TERMINAL, Key.R, ctrl = true, shift = true,
            description = "重置终端"),
    )

    /**
     * 处理键盘事件，返回匹配的 TerminalAction，未匹配返回 null。
     *
     * 在 TerminalScreen 中使用:
     * ```
     * Modifier.onPreviewKeyEvent { event ->
     *     val action = TerminalKeyboardShortcuts.handleKeyEvent(event)
     *     if (action != null) {
     *         dispatchTerminalAction(action)
     *         true  // 已消费
     *     } else {
     *         false
     *     }
     * }
     * ```
     */
    fun handleKeyEvent(event: androidx.compose.ui.input.key.KeyEvent): TerminalAction? {
        // 仅处理按下事件
        if (event.type != KeyEventType.KeyDown) return null

        val pressedKey = event.key
        val ctrl = event.isCtrlPressed
        val shift = event.isShiftPressed

        return defaultBindings.firstOrNull { binding ->
            binding.key == pressedKey &&
                binding.ctrl == ctrl &&
                binding.shift == shift
        }?.action
    }

    /**
     * 获取指定动作的快捷键显示文字（用于 CommandPalette 等 UI）
     */
    fun shortcutLabel(action: TerminalAction): String? {
        val binding = defaultBindings.firstOrNull { it.action == action } ?: return null
        val parts = mutableListOf<String>()
        if (binding.ctrl) parts.add("Ctrl")
        if (binding.shift) parts.add("Shift")
        parts.add(keyLabel(binding.key))
        return parts.joinToString("+")
    }

    private fun keyLabel(key: Key): String = when (key) {
        Key.Tab -> "Tab"
        Key.Equals -> "+"
        Key.Minus -> "-"
        else -> {
            // 从 Key 名称提取字母，如 Key.T → "T"
            val name = key.toString()
            val match = Regex("Key\\((.+)\\)").find(name)
            match?.groupValues?.get(1) ?: name
        }
    }
}

package sy.yuanio.app.ui.common

import android.content.Context
import androidx.annotation.StringRes

sealed interface UiText {
    data class Res(
        @param:StringRes @field:StringRes val id: Int,
        val args: List<Any> = emptyList(),
    ) : UiText

    data class Raw(val value: String) : UiText

    companion object {
        fun res(@StringRes id: Int, vararg args: Any): UiText = Res(id, args.toList())
        fun raw(value: String): UiText = Raw(value)
    }
}

fun UiText.resolve(context: Context): String {
    return when (this) {
        is UiText.Res -> context.getString(id, *args.toTypedArray())
        is UiText.Raw -> value
    }
}


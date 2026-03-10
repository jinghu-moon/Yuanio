package sy.yuanio.app.data

import androidx.annotation.StringRes
import sy.yuanio.app.R

enum class ModelMode(val value: String, @param:StringRes @field:StringRes val labelRes: Int) {
    DEFAULT("default", R.string.model_mode_default),
    SONNET("sonnet", R.string.model_mode_sonnet),
    OPUS("opus", R.string.model_mode_opus);

    companion object {
        fun fromValue(value: String): ModelMode =
            entries.firstOrNull { it.value == value } ?: DEFAULT
    }
}


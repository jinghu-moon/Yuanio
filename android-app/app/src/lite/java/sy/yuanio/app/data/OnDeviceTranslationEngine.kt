package sy.yuanio.app.data

import kotlinx.coroutines.delay

object OnDeviceTranslationEngine {
    suspend fun translate(
        text: String,
        direction: TranslateDirection,
    ): String {
        delay(50)
        throw UnsupportedOperationException("Translation not available in lite build")
    }
}

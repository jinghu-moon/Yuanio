package sy.yuanio.app.ui.screen

import android.content.Context
import android.net.Uri

class OcrEngineImpl : OcrEngine {
    override suspend fun recognizeText(context: Context, uri: Uri): String {
        throw UnsupportedOperationException("OCR not available in lite build")
    }
}

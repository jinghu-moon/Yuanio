package sy.yuanio.app.ui.screen

import android.content.Context
import android.net.Uri

interface OcrEngine {
    suspend fun recognizeText(context: Context, uri: Uri): String
}

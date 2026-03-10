package sy.yuanio.app.data

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object OnDeviceTranslationEngine {
    suspend fun translate(
        text: String,
        direction: TranslateDirection,
    ): String {
        val source = com.google.mlkit.nl.translate.TranslateLanguage.fromLanguageTag(direction.sourceTag)
            ?: throw IllegalStateException("Unsupported source language")
        val target = com.google.mlkit.nl.translate.TranslateLanguage.fromLanguageTag(direction.targetTag)
            ?: throw IllegalStateException("Unsupported target language")
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(source)
            .setTargetLanguage(target)
            .build()
        val translator = Translation.getClient(options)
        return try {
            translator.downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
            translator.translate(text).await()
        } finally {
            translator.close()
        }
    }

    private suspend fun <T> Task<T>.await(): T {
        return suspendCancellableCoroutine { cont ->
            addOnSuccessListener { result ->
                if (cont.isActive) cont.resume(result)
            }
            addOnFailureListener { error ->
                if (cont.isActive) cont.resumeWithException(error)
            }
            addOnCanceledListener {
                if (cont.isActive) cont.cancel()
            }
        }
    }
}


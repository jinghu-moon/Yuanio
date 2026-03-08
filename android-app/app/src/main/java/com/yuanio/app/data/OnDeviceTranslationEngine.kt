package com.yuanio.app.data

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

enum class TranslateDirection(
    val sourceLanguage: String,
    val targetLanguage: String,
) {
    ZH_TO_EN(TranslateLanguage.CHINESE, TranslateLanguage.ENGLISH),
    EN_TO_ZH(TranslateLanguage.ENGLISH, TranslateLanguage.CHINESE),
}

object OnDeviceTranslationEngine {
    suspend fun translate(
        text: String,
        direction: TranslateDirection,
    ): String {
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(direction.sourceLanguage)
            .setTargetLanguage(direction.targetLanguage)
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

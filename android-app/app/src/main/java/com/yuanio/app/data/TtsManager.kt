package com.yuanio.app.data

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

enum class TtsState { IDLE, SPEAKING }

class TtsManager(context: Context) : TextToSpeech.OnInitListener {

    private val tts = TextToSpeech(context.applicationContext, this)
    private var initialized = false

    var state: TtsState = TtsState.IDLE
        private set
    var onStateChange: ((TtsState) -> Unit)? = null
    var speakingIndex: Int = -1
        private set

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            initialized = true
            applySettings()
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    state = TtsState.SPEAKING
                    onStateChange?.invoke(state)
                }
                override fun onDone(utteranceId: String?) {
                    state = TtsState.IDLE
                    speakingIndex = -1
                    onStateChange?.invoke(state)
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    state = TtsState.IDLE
                    speakingIndex = -1
                    onStateChange?.invoke(state)
                }
            })
        }
    }

    fun applySettings() {
        if (!initialized) return
        tts.setSpeechRate(TtsPrefs.speechRate)
        tts.setPitch(TtsPrefs.pitch)
        val locale = Locale.forLanguageTag(TtsPrefs.language)
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) {
            tts.language = locale
        }
    }

    fun speak(text: String, index: Int) {
        if (!initialized) return
        stop()
        val clean = stripMarkdown(text)
        if (clean.isBlank()) return
        speakingIndex = index
        tts.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "tts_$index")
    }

    fun stop() {
        if (tts.isSpeaking) tts.stop()
        state = TtsState.IDLE
        speakingIndex = -1
        onStateChange?.invoke(state)
    }

    fun release() {
        stop()
        tts.shutdown()
    }

    companion object {
        /** 移除 Markdown 格式符号，保留纯文本 */
        fun stripMarkdown(text: String): String {
            var s = text
            // 移除代码块
            s = s.replace(Regex("```[\\s\\S]*?```"), " code block ")
            // 移除行内代码
            s = s.replace(Regex("`[^`]+`"), "")
            // 移除加粗/斜体
            s = s.replace(Regex("\\*{1,2}(.+?)\\*{1,2}")) { it.groupValues[1] }
            // 移除标题标记
            s = s.replace(Regex("^#{1,6}\\s+", RegexOption.MULTILINE), "")
            // 移除链接，保留文本
            s = s.replace(Regex("\\[(.+?)]\\(.+?\\)")) { it.groupValues[1] }
            // 移除多余空白
            s = s.replace(Regex("\\s+"), " ").trim()
            return s
        }
    }
}

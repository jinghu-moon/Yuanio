package com.yuanio.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import com.yuanio.app.data.ConnectionState
import com.yuanio.app.data.EnvelopeHelper
import com.yuanio.app.data.KeyStore
import com.yuanio.app.data.RelayClient

/**
 * 轻量 Activity，接收 Tasker / Shortcuts / Share 的 Intent，
 * 一次性连接 Relay 发送 prompt 后立即 finish。
 */
class ShortcutActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prompt = extractPrompt(intent)
        if (prompt.isNullOrBlank()) {
            Toast.makeText(this, getString(R.string.shortcut_toast_prompt_missing), Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val ks = KeyStore(this)
        if (ks.isVaultConfigured && ks.isVaultLocked) {
            startActivity(
                Intent(this, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("navigate_to", "chat")
                }
            )
            Toast.makeText(this, getString(R.string.shortcut_toast_unlock_first), Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val url = ks.serverUrl
        val token = ks.sessionToken
        val key = ks.sharedKey
        val deviceId = ks.deviceId
        val sessionId = ks.sessionId

        if (url == null || token == null || key == null || deviceId == null || sessionId == null) {
            Toast.makeText(this, getString(R.string.shortcut_toast_not_paired), Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val relay = RelayClient(url, token)
        relay.onStateChange = { state ->
            if (state == ConnectionState.CONNECTED) {
                relay.send(
                    EnvelopeHelper.create(
                        source = deviceId,
                        target = "broadcast",
                        sessionId = sessionId,
                        type = "prompt",
                        plaintext = prompt,
                        sharedKey = key,
                    )
                )
                runOnUiThread {
                    Toast.makeText(this, getString(R.string.shortcut_toast_sent), Toast.LENGTH_SHORT).show()
                    relay.disconnect()
                    finish()
                }
            }
        }
        relay.connect()
    }

    private fun extractPrompt(intent: Intent?): String? {
        if (intent == null) return null
        intent.getStringExtra("prompt")?.let { return it }
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            return intent.getStringExtra(Intent.EXTRA_TEXT)
        }
        return null
    }
}

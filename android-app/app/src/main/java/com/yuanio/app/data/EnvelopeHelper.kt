package com.yuanio.app.data

import com.yuanio.app.crypto.CryptoManager
import org.json.JSONObject
import java.util.UUID

object EnvelopeHelper {
    private var seq = 0

    private fun buildAad(
        id: String,
        seq: Int,
        source: String,
        target: String,
        sessionId: String,
        type: String,
        ptyId: String?,
        ts: Long,
    ): ByteArray {
        val aad = JSONObject()
        aad.put("v", 1)
        aad.put("id", id)
        aad.put("seq", seq)
        aad.put("source", source)
        aad.put("target", target)
        aad.put("sessionId", sessionId)
        aad.put("type", type)
        if (!ptyId.isNullOrBlank()) aad.put("ptyId", ptyId)
        aad.put("ts", ts)
        return aad.toString().toByteArray()
    }

    private fun buildAadFromEnvelope(envelope: JSONObject): ByteArray {
        val ptyId = if (envelope.has("ptyId")) envelope.optString("ptyId") else null
        return buildAad(
            id = envelope.getString("id"),
            seq = envelope.getInt("seq"),
            source = envelope.getString("source"),
            target = envelope.getString("target"),
            sessionId = envelope.getString("sessionId"),
            type = envelope.getString("type"),
            ptyId = ptyId,
            ts = envelope.getLong("ts"),
        )
    }

    fun create(
        source: String, target: String, sessionId: String,
        type: String, plaintext: String, sharedKey: ByteArray,
        ptyId: String? = null
    ): JSONObject {
        seq++
        val id = UUID.randomUUID().toString()
        val ts = System.currentTimeMillis()
        val aad = buildAad(id, seq, source, target, sessionId, type, ptyId, ts)
        return JSONObject().apply {
            put("id", id)
            put("seq", seq)
            put("source", source)
            put("target", target)
            put("sessionId", sessionId)
            put("type", type)
            if (!ptyId.isNullOrBlank()) put("ptyId", ptyId)
            put("ts", ts)
            put("payload", CryptoManager.toBase64(
                CryptoManager.encrypt(plaintext.toByteArray(), sharedKey, aad)
            ))
        }
    }

    fun decryptPayload(envelope: JSONObject, sharedKey: ByteArray): String {
        val aad = buildAadFromEnvelope(envelope)
        val payload = CryptoManager.fromBase64(envelope.getString("payload"))
        return String(CryptoManager.decrypt(payload, sharedKey, aad))
    }

    // --- Binary 变体：PTY 高频消息，跳过 Base64 减少 33% 带宽 ---

    fun createBinary(
        source: String, target: String, sessionId: String,
        type: String, plaintext: String, sharedKey: ByteArray,
        ptyId: String? = null
    ): Pair<JSONObject, ByteArray> {
        seq++
        val id = UUID.randomUUID().toString()
        val ts = System.currentTimeMillis()
        val header = JSONObject().apply {
            put("id", id)
            put("seq", seq)
            put("source", source)
            put("target", target)
            put("sessionId", sessionId)
            put("type", type)
            if (!ptyId.isNullOrBlank()) put("ptyId", ptyId)
            put("ts", ts)
        }
        val aad = buildAad(id, seq, source, target, sessionId, type, ptyId, ts)
        val payload = CryptoManager.encrypt(plaintext.toByteArray(), sharedKey, aad)
        return header to payload
    }

    fun decryptBinaryPayload(envelope: JSONObject, binaryPayload: ByteArray, sharedKey: ByteArray): String {
        val aad = buildAadFromEnvelope(envelope)
        return String(CryptoManager.decrypt(binaryPayload, sharedKey, aad))
    }
}

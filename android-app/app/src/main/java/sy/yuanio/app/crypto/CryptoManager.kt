package sy.yuanio.app.crypto

import android.util.Base64
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.KeyPairGenerator

object CryptoManager {
    const val DEFAULT_E2EE_INFO = "yuanio-e2ee-v1"
    private const val AES_KEY_BYTES = 32
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BITS = 128

    data class KeyPair(val publicKey: ByteArray, val privateKey: PrivateKey)

    fun generateKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance("EC")
        kpg.initialize(ECGenParameterSpec("secp256r1"))
        val kp = kpg.generateKeyPair()
        return KeyPair(kp.public.encoded, kp.private)
    }

    fun deriveSharedKey(
        privateKey: PrivateKey,
        peerPublic: ByteArray,
        salt: ByteArray,
        info: ByteArray = DEFAULT_E2EE_INFO.toByteArray(),
    ): ByteArray {
        require(salt.isNotEmpty()) { "salt is required" }
        val keyFactory = KeyFactory.getInstance("EC")
        val peer = keyFactory.generatePublic(X509EncodedKeySpec(peerPublic))

        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(privateKey)
        ka.doPhase(peer, true)
        val sharedSecret = ka.generateSecret()

        val hkdf = HKDFBytesGenerator(SHA256Digest())
        hkdf.init(HKDFParameters(sharedSecret, salt, info))
        val out = ByteArray(AES_KEY_BYTES)
        hkdf.generateBytes(out, 0, out.size)
        return out
    }

    fun decodePrivateKey(encoded: ByteArray): PrivateKey {
        val keyFactory = KeyFactory.getInstance("EC")
        return keyFactory.generatePrivate(PKCS8EncodedKeySpec(encoded))
    }

    fun encrypt(plaintext: ByteArray, key: ByteArray, aad: ByteArray): ByteArray {
        val iv = ByteArray(GCM_IV_BYTES)
        SecureRandom().nextBytes(iv)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad)
        val cipherText = cipher.doFinal(plaintext)
        return iv + cipherText
    }

    fun decrypt(data: ByteArray, key: ByteArray, aad: ByteArray): ByteArray {
        val iv = data.copyOfRange(0, GCM_IV_BYTES)
        val cipherText = data.copyOfRange(GCM_IV_BYTES, data.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(cipherText)
    }

    fun toBase64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    fun fromBase64(str: String): ByteArray = Base64.decode(str, Base64.NO_WRAP)
}


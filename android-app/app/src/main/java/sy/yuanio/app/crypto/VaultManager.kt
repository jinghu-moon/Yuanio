package sy.yuanio.app.crypto

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricPrompt
import java.security.KeyStore
import java.util.Arrays
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class VaultManager(context: Context) {

    enum class VaultState {
        NOT_CONFIGURED,
        LOCKED,
        UNLOCKED,
    }

    enum class CredentialType(val value: String) {
        PASSWORD("password"),
        PATTERN("pattern"),
        NONE("none");

        companion object {
            fun fromStorage(value: String?): CredentialType {
                return when (value) {
                    PATTERN.value -> PATTERN
                    NONE.value -> NONE
                    "pin", PASSWORD.value -> PASSWORD
                    else -> PASSWORD
                }
            }
        }
    }

    private data class CacheEntry(
        val privateKey: ByteArray?,
        val sharedKey: ByteArray?,
        val sessionToken: String?,
    ) {
        fun copyDeep(): CacheEntry {
            return CacheEntry(
                privateKey = privateKey?.copyOf(),
                sharedKey = sharedKey?.copyOf(),
                sessionToken = sessionToken,
            )
        }
    }

    private val prefs = context.applicationContext
        .getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    val isConfigured: Boolean
        get() = prefs.getBoolean(KEY_CONFIGURED, false)

    val state: VaultState
        get() {
            if (!isConfigured) return VaultState.NOT_CONFIGURED
            return if (peekRuntimeMdk() != null) VaultState.UNLOCKED else VaultState.LOCKED
        }

    val credentialType: CredentialType
        get() = CredentialType.fromStorage(prefs.getString(KEY_CREDENTIAL_TYPE, null))

    /**
     * 兼容旧版本 "pin" 存储值。
     * 旧用户升级后仍应走数字键盘解锁，而不是退化成通用密码输入框。
     */
    val isLegacyPinCredential: Boolean
        get() = prefs.getString(KEY_CREDENTIAL_TYPE, null) == "pin"

    val needsMigration: Boolean
        get() = !isConfigured

    val failedAttempts: Int
        get() = prefs.getInt(KEY_FAILED_ATTEMPTS, 0)

    val lockoutRemainingMs: Long
        get() {
            val now = System.currentTimeMillis()
            val until = prefs.getLong(KEY_LOCKOUT_UNTIL, 0L)
            return (until - now).coerceAtLeast(0L)
        }

    var autoLockTimeoutMs: Long
        get() = prefs.getLong(KEY_AUTO_LOCK_TIMEOUT, DEFAULT_AUTO_LOCK_TIMEOUT_MS)
        set(value) {
            prefs.edit().putLong(KEY_AUTO_LOCK_TIMEOUT, value).apply()
        }

    fun hasProfileSecrets(profile: String): Boolean {
        return prefs.contains(encryptedKey(profile, FIELD_SHARED_KEY))
    }

    fun getCachedPrivateKey(profile: String): ByteArray? {
        return getOrLoadCache(profile)?.privateKey?.copyOf()
    }

    fun getCachedSharedKey(profile: String): ByteArray? {
        return getOrLoadCache(profile)?.sharedKey?.copyOf()
    }

    fun getCachedSessionToken(profile: String): String? {
        return getOrLoadCache(profile)?.sessionToken
    }

    fun setup(
        credential: String,
        type: CredentialType,
        profile: String,
        privateKey: ByteArray,
        sharedKey: ByteArray,
        sessionToken: String,
        enableBiometric: Boolean = false,
    ): Boolean {
        val salt = KeyDerivation.generateSalt()
        val kek = KeyDerivation.deriveKek(normalizeCredential(type, credential), salt)
        val mdk = KeyDerivation.generateMdk()
        return try {
            val wrappedMdk = CryptoManager.encrypt(mdk, kek, aadGlobal("mdk"))
            val verifier = CryptoManager.encrypt(VERIFIER_TOKEN.toByteArray(), mdk, aadGlobal("verifier"))

            prefs.edit()
                .putBoolean(KEY_CONFIGURED, true)
                .putString(KEY_SALT, CryptoManager.toBase64(salt))
                .putString(KEY_WRAPPED_MDK, CryptoManager.toBase64(wrappedMdk))
                .putString(KEY_VERIFIER, CryptoManager.toBase64(verifier))
                .putString(KEY_CREDENTIAL_TYPE, type.value)
                .putString(encryptedKey(profile, FIELD_PRIVATE_KEY), encryptFieldBytes(profile, FIELD_PRIVATE_KEY, privateKey, mdk))
                .putString(encryptedKey(profile, FIELD_SHARED_KEY), encryptFieldBytes(profile, FIELD_SHARED_KEY, sharedKey, mdk))
                .putString(encryptedKey(profile, FIELD_SESSION_TOKEN), encryptFieldText(profile, FIELD_SESSION_TOKEN, sessionToken, mdk))
                .putInt(KEY_FAILED_ATTEMPTS, 0)
                .putLong(KEY_LOCKOUT_UNTIL, 0L)
                .apply()

            setRuntime(
                mdk = mdk,
                profile = profile,
                cache = CacheEntry(
                    privateKey = privateKey.copyOf(),
                    sharedKey = sharedKey.copyOf(),
                    sessionToken = sessionToken,
                )
            )

            if (enableBiometric) {
                enableBiometric(kek)
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(kek, 0)
            Arrays.fill(mdk, 0)
        }
    }

    fun unlock(credential: String, profile: String): Boolean {
        if (!isConfigured || lockoutRemainingMs > 0L) return false
        val salt = readSalt() ?: return false
        val kek = KeyDerivation.deriveKek(normalizeCredential(credentialType, credential), salt)
        return try {
            val ok = unlockWithKekInternal(kek, profile)
            if (ok) resetFailedAttempts() else recordFailedAttempt()
            ok
        } finally {
            Arrays.fill(kek, 0)
        }
    }

    fun unlockWithKek(kek: ByteArray, profile: String): Boolean {
        if (!isConfigured || lockoutRemainingMs > 0L) return false
        val ok = unlockWithKekInternal(kek, profile)
        if (ok) resetFailedAttempts() else recordFailedAttempt()
        return ok
    }

    fun lock() {
        clearRuntime()
    }

    fun saveSensitiveFields(
        profile: String,
        privateKey: ByteArray,
        sharedKey: ByteArray,
        sessionToken: String,
    ): Boolean {
        val mdk = peekRuntimeMdk()?.copyOf() ?: return false
        return try {
            prefs.edit()
                .putString(encryptedKey(profile, FIELD_PRIVATE_KEY), encryptFieldBytes(profile, FIELD_PRIVATE_KEY, privateKey, mdk))
                .putString(encryptedKey(profile, FIELD_SHARED_KEY), encryptFieldBytes(profile, FIELD_SHARED_KEY, sharedKey, mdk))
                .putString(encryptedKey(profile, FIELD_SESSION_TOKEN), encryptFieldText(profile, FIELD_SESSION_TOKEN, sessionToken, mdk))
                .apply()

            synchronized(runtimeLock) {
                runtimeCache[profile] = CacheEntry(
                    privateKey = privateKey.copyOf(),
                    sharedKey = sharedKey.copyOf(),
                    sessionToken = sessionToken,
                )
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(mdk, 0)
        }
    }

    fun updateSharedKey(profile: String, newKey: ByteArray): Boolean {
        val mdk = peekRuntimeMdk()?.copyOf() ?: return false
        return try {
            prefs.edit()
                .putString(encryptedKey(profile, FIELD_SHARED_KEY), encryptFieldBytes(profile, FIELD_SHARED_KEY, newKey, mdk))
                .apply()
            synchronized(runtimeLock) {
                val current = runtimeCache[profile]
                runtimeCache[profile] = CacheEntry(
                    privateKey = current?.privateKey?.copyOf(),
                    sharedKey = newKey.copyOf(),
                    sessionToken = current?.sessionToken,
                )
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(mdk, 0)
        }
    }

    fun updateSessionToken(profile: String, newToken: String): Boolean {
        val mdk = peekRuntimeMdk()?.copyOf() ?: return false
        return try {
            prefs.edit()
                .putString(encryptedKey(profile, FIELD_SESSION_TOKEN), encryptFieldText(profile, FIELD_SESSION_TOKEN, newToken, mdk))
                .apply()
            synchronized(runtimeLock) {
                val current = runtimeCache[profile]
                runtimeCache[profile] = CacheEntry(
                    privateKey = current?.privateKey?.copyOf(),
                    sharedKey = current?.sharedKey?.copyOf(),
                    sessionToken = newToken,
                )
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(mdk, 0)
        }
    }

    fun clearProfile(profile: String) {
        prefs.edit()
            .remove(encryptedKey(profile, FIELD_PRIVATE_KEY))
            .remove(encryptedKey(profile, FIELD_SHARED_KEY))
            .remove(encryptedKey(profile, FIELD_SESSION_TOKEN))
            .apply()
        synchronized(runtimeLock) {
            runtimeCache.remove(profile)?.let { clearCacheEntry(it) }
        }
    }

    fun changeCredential(
        oldCredential: String,
        newCredential: String,
        newType: CredentialType,
        profile: String,
    ): Boolean {
        if (!isConfigured) return false
        val oldSalt = readSalt() ?: return false
        val oldKek = KeyDerivation.deriveKek(normalizeCredential(credentialType, oldCredential), oldSalt)
        val mdk = unwrapMdk(oldKek) ?: run {
            Arrays.fill(oldKek, 0)
            return false
        }

        return try {
            if (!verifyMdk(mdk)) {
                false
            } else {
                val newSalt = KeyDerivation.generateSalt()
                val newKek = KeyDerivation.deriveKek(normalizeCredential(newType, newCredential), newSalt)
                try {
                    val newWrappedMdk = CryptoManager.encrypt(mdk, newKek, aadGlobal("mdk"))
                    prefs.edit()
                        .putString(KEY_SALT, CryptoManager.toBase64(newSalt))
                        .putString(KEY_WRAPPED_MDK, CryptoManager.toBase64(newWrappedMdk))
                        .putString(KEY_CREDENTIAL_TYPE, newType.value)
                        .apply()

                    if (isBiometricEnabled()) {
                        enableBiometric(newKek)
                    }

                    if (state == VaultState.UNLOCKED) {
                        val cache = getOrLoadCache(profile)
                        if (cache != null) {
                            setRuntime(mdk, profile, cache)
                        }
                    }
                    true
                } finally {
                    Arrays.fill(newKek, 0)
                }
            }
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(oldKek, 0)
            Arrays.fill(mdk, 0)
        }
    }

    fun enableBiometricWithCredential(credential: String): Boolean {
        val salt = readSalt() ?: return false
        val kek = KeyDerivation.deriveKek(normalizeCredential(credentialType, credential), salt)
        return try {
            if (unwrapMdk(kek) == null) return false
            enableBiometric(kek)
        } finally {
            Arrays.fill(kek, 0)
        }
    }

    fun enableBiometric(kek: ByteArray): Boolean {
        return try {
            val key = getOrCreateBiometricKey()
            val cipher = Cipher.getInstance(AES_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encrypted = cipher.iv + cipher.doFinal(kek)
            prefs.edit().putString(KEY_BIOMETRIC_KEK, CryptoManager.toBase64(encrypted)).apply()
            true
        } catch (_: Exception) {
            false
        }
    }

    fun disableBiometric() {
        prefs.edit().remove(KEY_BIOMETRIC_KEK).apply()
        try {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE)
            ks.load(null)
            if (ks.containsAlias(BIOMETRIC_KEY_ALIAS)) {
                ks.deleteEntry(BIOMETRIC_KEY_ALIAS)
            }
        } catch (_: Exception) {
            // ignore
        }
    }

    fun isBiometricEnabled(): Boolean {
        return prefs.contains(KEY_BIOMETRIC_KEK) && getBiometricKey() != null
    }

    fun getBiometricCryptoObject(): BiometricPrompt.CryptoObject? {
        val encrypted = prefs.getString(KEY_BIOMETRIC_KEK, null) ?: return null
        return try {
            val blob = CryptoManager.fromBase64(encrypted)
            if (blob.size <= GCM_IV_BYTES) return null
            val iv = blob.copyOfRange(0, GCM_IV_BYTES)
            val key = getBiometricKey() ?: return null
            val cipher = Cipher.getInstance(AES_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            BiometricPrompt.CryptoObject(cipher)
        } catch (_: Exception) {
            null
        }
    }

    fun decryptKekWithBiometric(cipher: Cipher): ByteArray? {
        val encrypted = prefs.getString(KEY_BIOMETRIC_KEK, null) ?: return null
        return try {
            val blob = CryptoManager.fromBase64(encrypted)
            if (blob.size <= GCM_IV_BYTES) return null
            val payload = blob.copyOfRange(GCM_IV_BYTES, blob.size)
            cipher.doFinal(payload)
        } catch (_: Exception) {
            null
        }
    }

    fun recordFailedAttempt() {
        val next = failedAttempts + 1
        val lockMs = when {
            next >= 10 -> 5 * 60_000L
            next >= 5 -> 30_000L
            else -> 0L
        }
        prefs.edit()
            .putInt(KEY_FAILED_ATTEMPTS, next)
            .putLong(KEY_LOCKOUT_UNTIL, if (lockMs > 0L) System.currentTimeMillis() + lockMs else 0L)
            .apply()
    }

    fun resetFailedAttempts() {
        prefs.edit()
            .putInt(KEY_FAILED_ATTEMPTS, 0)
            .putLong(KEY_LOCKOUT_UNTIL, 0L)
            .apply()
    }

    private fun unlockWithKekInternal(kek: ByteArray, profile: String): Boolean {
        val mdk = unwrapMdk(kek) ?: return false
        return try {
            if (!verifyMdk(mdk)) return false
            val cache = CacheEntry(
                privateKey = decryptFieldBytes(profile, FIELD_PRIVATE_KEY, mdk),
                sharedKey = decryptFieldBytes(profile, FIELD_SHARED_KEY, mdk),
                sessionToken = decryptFieldText(profile, FIELD_SESSION_TOKEN, mdk),
            )
            setRuntime(mdk, profile, cache)
            true
        } catch (_: Exception) {
            false
        } finally {
            Arrays.fill(mdk, 0)
        }
    }

    private fun verifyMdk(mdk: ByteArray): Boolean {
        val verifier = prefs.getString(KEY_VERIFIER, null) ?: return false
        return try {
            val plain = CryptoManager.decrypt(CryptoManager.fromBase64(verifier), mdk, aadGlobal("verifier"))
            plain.contentEquals(VERIFIER_TOKEN.toByteArray())
        } catch (_: Exception) {
            false
        }
    }

    private fun unwrapMdk(kek: ByteArray): ByteArray? {
        val wrapped = prefs.getString(KEY_WRAPPED_MDK, null) ?: return null
        return try {
            CryptoManager.decrypt(CryptoManager.fromBase64(wrapped), kek, aadGlobal("mdk"))
        } catch (_: Exception) {
            null
        }
    }

    private fun readSalt(): ByteArray? {
        val encoded = prefs.getString(KEY_SALT, null) ?: return null
        return try {
            CryptoManager.fromBase64(encoded)
        } catch (_: Exception) {
            null
        }
    }

    private fun setRuntime(mdk: ByteArray, profile: String, cache: CacheEntry) {
        synchronized(runtimeLock) {
            clearRuntimeLocked()
            runtimeMdk = mdk.copyOf()
            runtimeCache[profile] = cache.copyDeep()
        }
    }

    private fun clearRuntime() {
        synchronized(runtimeLock) {
            clearRuntimeLocked()
        }
    }

    private fun clearRuntimeLocked() {
        runtimeMdk?.fill(0)
        runtimeMdk = null
        runtimeCache.values.forEach { clearCacheEntry(it) }
        runtimeCache.clear()
    }

    private fun clearCacheEntry(entry: CacheEntry) {
        entry.privateKey?.fill(0)
        entry.sharedKey?.fill(0)
    }

    private fun peekRuntimeMdk(): ByteArray? {
        return synchronized(runtimeLock) { runtimeMdk }
    }

    private fun getOrLoadCache(profile: String): CacheEntry? {
        synchronized(runtimeLock) {
            runtimeCache[profile]?.let { return it.copyDeep() }
        }

        val mdk = peekRuntimeMdk()?.copyOf() ?: return null
        return try {
            val loaded = CacheEntry(
                privateKey = decryptFieldBytes(profile, FIELD_PRIVATE_KEY, mdk),
                sharedKey = decryptFieldBytes(profile, FIELD_SHARED_KEY, mdk),
                sessionToken = decryptFieldText(profile, FIELD_SESSION_TOKEN, mdk),
            )
            synchronized(runtimeLock) {
                runtimeCache[profile] = loaded.copyDeep()
            }
            loaded
        } finally {
            Arrays.fill(mdk, 0)
        }
    }

    private fun encryptFieldBytes(profile: String, field: String, value: ByteArray, mdk: ByteArray): String {
        val encrypted = CryptoManager.encrypt(value, mdk, aad(profile, field))
        return CryptoManager.toBase64(encrypted)
    }

    private fun encryptFieldText(profile: String, field: String, value: String, mdk: ByteArray): String {
        val encrypted = CryptoManager.encrypt(value.toByteArray(), mdk, aad(profile, field))
        return CryptoManager.toBase64(encrypted)
    }

    private fun decryptFieldBytes(profile: String, field: String, mdk: ByteArray): ByteArray? {
        val encoded = prefs.getString(encryptedKey(profile, field), null) ?: return null
        return try {
            CryptoManager.decrypt(CryptoManager.fromBase64(encoded), mdk, aad(profile, field))
        } catch (_: Exception) {
            null
        }
    }

    private fun decryptFieldText(profile: String, field: String, mdk: ByteArray): String? {
        return decryptFieldBytes(profile, field, mdk)?.toString(Charsets.UTF_8)
    }

    private fun encryptedKey(profile: String, field: String): String {
        return "vault_encrypted_${profile}_$field"
    }

    private fun normalizeCredential(type: CredentialType, value: String): String {
        return if (type == CredentialType.NONE) NONE_CREDENTIAL else value
    }

    private fun aadGlobal(field: String): ByteArray {
        return "vault:$field".toByteArray()
    }

    private fun aad(profile: String, field: String): ByteArray {
        return "vault:$profile:$field".toByteArray()
    }

    private fun getBiometricKey(): SecretKey? {
        return try {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE)
            ks.load(null)
            ks.getKey(BIOMETRIC_KEY_ALIAS, null) as? SecretKey
        } catch (_: Exception) {
            null
        }
    }

    private fun getOrCreateBiometricKey(): SecretKey {
        getBiometricKey()?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val builder = KeyGenParameterSpec.Builder(
            BIOMETRIC_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            applyLegacyUserAuthenticationValidity(builder)
        }

        keyGenerator.init(builder.build())
        return keyGenerator.generateKey()
    }

    @Suppress("DEPRECATION")
    private fun applyLegacyUserAuthenticationValidity(builder: KeyGenParameterSpec.Builder) {
        builder.setUserAuthenticationValidityDurationSeconds(-1)
    }

    companion object {
        const val NONE_CREDENTIAL = "__yuanio_unlock_none__"

        private const val PREF_NAME = "yuanio_vault"
        private const val KEY_CONFIGURED = "vault_configured"
        private const val KEY_SALT = "vault_salt"
        private const val KEY_WRAPPED_MDK = "vault_wrapped_mdk"
        private const val KEY_VERIFIER = "vault_credential_verifier"
        private const val KEY_CREDENTIAL_TYPE = "vault_credential_type"
        private const val KEY_BIOMETRIC_KEK = "vault_biometric_encrypted_kek"
        private const val KEY_FAILED_ATTEMPTS = "vault_failed_attempts"
        private const val KEY_LOCKOUT_UNTIL = "vault_lockout_until"
        private const val KEY_AUTO_LOCK_TIMEOUT = "vault_auto_lock_timeout"

        private const val FIELD_PRIVATE_KEY = "privateKey"
        private const val FIELD_SHARED_KEY = "sharedKey"
        private const val FIELD_SESSION_TOKEN = "sessionToken"

        private const val VERIFIER_TOKEN = "yuanio-vault-ok"
        private const val DEFAULT_AUTO_LOCK_TIMEOUT_MS = 60_000L

        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val BIOMETRIC_KEY_ALIAS = "yuanio_vault_biometric"
        private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128

        private val runtimeLock = Any()
        private var runtimeMdk: ByteArray? = null
        private val runtimeCache = mutableMapOf<String, CacheEntry>()
    }
}


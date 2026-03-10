package sy.yuanio.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import sy.yuanio.app.crypto.CryptoManager
import sy.yuanio.app.crypto.VaultManager

class KeyStore(context: Context) {
    private val prefs: SharedPreferences
    val vaultManager = VaultManager(context.applicationContext)

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            "yuanio_keys",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var activeProfile: String
        get() = prefs.getString("_active", "default") ?: "default"
        set(value) = prefs.edit().putString("_active", value).apply()

    private fun key(field: String) = "${activeProfile}:$field"

    val isVaultConfigured: Boolean
        get() = vaultManager.isConfigured

    val isVaultLocked: Boolean
        get() = vaultManager.state == VaultManager.VaultState.LOCKED

    val needsVaultMigration: Boolean
        get() {
            if (isVaultConfigured) return false
            return prefs.contains(key("privateKey"))
                && prefs.contains(key("sharedKey"))
                && prefs.contains(key("sessionToken"))
        }

    val vaultCredentialType: VaultManager.CredentialType
        get() = vaultManager.credentialType

    val vaultBiometricEnabled: Boolean
        get() = vaultManager.isBiometricEnabled()

    var vaultAutoLockTimeoutMs: Long
        get() = vaultManager.autoLockTimeoutMs
        set(value) {
            vaultManager.autoLockTimeoutMs = value
        }

    fun lockVault() {
        vaultManager.lock()
    }

    fun migrateToVault(
        credential: String,
        type: VaultManager.CredentialType,
        enableBiometric: Boolean,
    ): Boolean {
        if (vaultManager.isConfigured) return true

        val privateKey = prefs.getString(key("privateKey"), null)?.let { CryptoManager.fromBase64(it) }
        val sharedKey = prefs.getString(key("sharedKey"), null)?.let { CryptoManager.fromBase64(it) }
        val sessionToken = prefs.getString(key("sessionToken"), null)

        if (privateKey == null || sharedKey == null || sessionToken.isNullOrBlank()) {
            return false
        }

        val migrated = vaultManager.setup(
            credential = credential,
            type = type,
            profile = activeProfile,
            privateKey = privateKey,
            sharedKey = sharedKey,
            sessionToken = sessionToken,
            enableBiometric = enableBiometric,
        )

        if (migrated) {
            prefs.edit()
                .remove(key("privateKey"))
                .remove(key("sharedKey"))
                .remove(key("sessionToken"))
                .apply()
        }

        return migrated
    }

    fun changeVaultCredential(
        oldCredential: String,
        newCredential: String,
        newType: VaultManager.CredentialType,
    ): Boolean {
        return vaultManager.changeCredential(
            oldCredential = oldCredential,
            newCredential = newCredential,
            newType = newType,
            profile = activeProfile,
        )
    }

    fun setVaultBiometric(enabled: Boolean, credential: String?): Boolean {
        if (!vaultManager.isConfigured) return false
        if (!enabled) {
            vaultManager.disableBiometric()
            return true
        }
        val cred = credential?.trim().orEmpty()
        val effectiveCredential = if (cred.isBlank() && vaultManager.credentialType == VaultManager.CredentialType.NONE) {
            VaultManager.NONE_CREDENTIAL
        } else {
            cred
        }
        if (effectiveCredential.isBlank()) return false
        return vaultManager.enableBiometricWithCredential(effectiveCredential)
    }

    fun save(
        publicKey: ByteArray,
        privateKey: ByteArray,
        peerPublicKey: ByteArray,
        sharedKey: ByteArray,
        deviceId: String,
        sessionId: String,
        sessionToken: String,
        serverUrl: String,
    ) {
        val editor = prefs.edit()
            .putString(key("publicKey"), CryptoManager.toBase64(publicKey))
            .putString(key("peerPublicKey"), CryptoManager.toBase64(peerPublicKey))
            .putString(key("deviceId"), deviceId)
            .putString(key("sessionId"), sessionId)
            .putString(key("serverUrl"), serverUrl)
            .putLong(key("lastSeenTs"), 0L)
            .putLong(key("lastSeenCursor"), 0L)

        if (vaultManager.isConfigured) {
            val saved = vaultManager.saveSensitiveFields(
                profile = activeProfile,
                privateKey = privateKey,
                sharedKey = sharedKey,
                sessionToken = sessionToken,
            )
            if (!saved) {
                throw IllegalStateException("Vault locked, sensitive fields cannot be saved")
            }
            editor
                .remove(key("privateKey"))
                .remove(key("sharedKey"))
                .remove(key("sessionToken"))
        } else {
            editor
                .putString(key("privateKey"), CryptoManager.toBase64(privateKey))
                .putString(key("sharedKey"), CryptoManager.toBase64(sharedKey))
                .putString(key("sessionToken"), sessionToken)
        }

        editor.apply()

        val profiles = profileNames().toMutableSet()
        profiles.add(activeProfile)
        prefs.edit().putStringSet("_profiles", profiles).apply()
    }

    val isPaired: Boolean
        get() = if (vaultManager.isConfigured) {
            vaultManager.hasProfileSecrets(activeProfile)
        } else {
            prefs.contains(key("sharedKey"))
        }

    val publicKey: ByteArray?
        get() = prefs.getString(key("publicKey"), null)?.let { CryptoManager.fromBase64(it) }

    val privateKey: ByteArray?
        get() {
            if (vaultManager.isConfigured) {
                return vaultManager.getCachedPrivateKey(activeProfile)
            }
            return prefs.getString(key("privateKey"), null)?.let { CryptoManager.fromBase64(it) }
        }

    val peerPublicKey: ByteArray?
        get() = prefs.getString(key("peerPublicKey"), null)?.let { CryptoManager.fromBase64(it) }

    val sharedKey: ByteArray?
        get() {
            if (vaultManager.isConfigured) {
                return vaultManager.getCachedSharedKey(activeProfile)
            }
            return prefs.getString(key("sharedKey"), null)?.let { CryptoManager.fromBase64(it) }
        }

    val sessionToken: String?
        get() {
            if (vaultManager.isConfigured) {
                return vaultManager.getCachedSessionToken(activeProfile)
            }
            return prefs.getString(key("sessionToken"), null)
        }

    val sessionId: String?
        get() = prefs.getString(key("sessionId"), null)

    val serverUrl: String?
        get() = prefs.getString(key("serverUrl"), null)

    val deviceId: String?
        get() = prefs.getString(key("deviceId"), null)

    var lastViewedSessionId: String?
        get() = prefs.getString(key("lastViewedSessionId"), null)
        set(value) = prefs.edit().putString(key("lastViewedSessionId"), value).apply()

    var lastSeenTs: Long
        get() = prefs.getLong(key("lastSeenTs"), 0L)
        set(value) = prefs.edit().putLong(key("lastSeenTs"), value).apply()

    var lastSeenCursor: Long
        get() = prefs.getLong(key("lastSeenCursor"), 0L)
        set(value) = prefs.edit().putLong(key("lastSeenCursor"), value).apply()

    fun updateSessionToken(newToken: String) {
        if (vaultManager.isConfigured) {
            val updated = vaultManager.updateSessionToken(activeProfile, newToken)
            if (!updated) throw IllegalStateException("Vault locked, session token cannot be updated")
            return
        }
        prefs.edit().putString(key("sessionToken"), newToken).apply()
    }

    fun updateSession(newSessionId: String, newSessionToken: String, newSharedKey: ByteArray) {
        if (vaultManager.isConfigured) {
            val sharedUpdated = vaultManager.updateSharedKey(activeProfile, newSharedKey)
            val tokenUpdated = vaultManager.updateSessionToken(activeProfile, newSessionToken)
            if (!sharedUpdated || !tokenUpdated) {
                throw IllegalStateException("Vault locked, session cannot be switched")
            }
            prefs.edit()
                .putString(key("sessionId"), newSessionId)
                .putString(key("lastViewedSessionId"), newSessionId)
                .putLong(key("lastSeenTs"), 0L)
                .putLong(key("lastSeenCursor"), 0L)
                .remove(key("sharedKey"))
                .remove(key("sessionToken"))
                .apply()
            return
        }

        prefs.edit()
            .putString(key("sessionId"), newSessionId)
            .putString(key("sessionToken"), newSessionToken)
            .putString(key("sharedKey"), CryptoManager.toBase64(newSharedKey))
            .putString(key("lastViewedSessionId"), newSessionId)
            .putLong(key("lastSeenTs"), 0L)
            .putLong(key("lastSeenCursor"), 0L)
            .apply()
    }

    fun profileNames(): Set<String> = prefs.getStringSet("_profiles", emptySet()) ?: emptySet()

    fun unpair() {
        val fields = listOf(
            "publicKey", "privateKey", "peerPublicKey", "sharedKey",
            "deviceId", "sessionId", "sessionToken", "serverUrl",
            "lastViewedSessionId", "lastSeenTs", "lastSeenCursor",
        )
        val edit = prefs.edit()
        fields.forEach { edit.remove(key(it)) }
        val profiles = profileNames().toMutableSet()
        profiles.remove(activeProfile)
        edit.putStringSet("_profiles", profiles)
        edit.apply()

        vaultManager.clearProfile(activeProfile)
    }
}


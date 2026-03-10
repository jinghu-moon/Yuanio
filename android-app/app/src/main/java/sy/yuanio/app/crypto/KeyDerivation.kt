package sy.yuanio.app.crypto

import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import java.security.SecureRandom

object KeyDerivation {
    private const val ARGON2_MEMORY_KB = 37 * 1024
    private const val ARGON2_ITERATIONS = 1
    private const val ARGON2_PARALLELISM = 4
    private const val KEK_BYTES = 32
    private const val SALT_BYTES = 16
    private const val MDK_BYTES = 32

    fun deriveKek(credential: String, salt: ByteArray): ByteArray {
        require(salt.isNotEmpty()) { "salt must not be empty" }
        val result = argon2Kt.hash(
            mode = Argon2Mode.ARGON2_ID,
            password = credential.toByteArray(),
            salt = salt,
            tCostInIterations = ARGON2_ITERATIONS,
            mCostInKibibyte = ARGON2_MEMORY_KB,
            parallelism = ARGON2_PARALLELISM,
            hashLengthInBytes = KEK_BYTES,
            version = Argon2Version.V13,
        )
        val rawBuffer = result.rawHash
        val out = ByteArray(rawBuffer.remaining())
        rawBuffer.get(out)
        return out
    }

    fun generateMdk(): ByteArray = ByteArray(MDK_BYTES).also { SecureRandom().nextBytes(it) }

    fun generateSalt(): ByteArray = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }

    fun serializePattern(pattern: List<Int>): String = pattern.joinToString(",")

    private val argon2Kt by lazy { Argon2Kt() }
}


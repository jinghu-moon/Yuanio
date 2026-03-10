package sy.yuanio.app.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import sy.yuanio.app.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

data class UriFileMeta(
    val uri: Uri,
    val fileName: String,
    val mimeType: String?,
    val sizeBytes: Long?,
)

object UriFileUtils {
    fun resolveMeta(context: Context, uri: Uri): UriFileMeta {
        val resolver = context.contentResolver
        var name: String? = null
        var size: Long? = null
        if (uri.scheme == "content") {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIdx >= 0) name = cursor.getString(nameIdx)
                        val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                    }
                }
        }
        val fallbackName = uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null }
        return UriFileMeta(
            uri = uri,
            fileName = sanitizeFileName(name ?: fallbackName ?: "upload.bin"),
            mimeType = resolver.getType(uri),
            sizeBytes = size?.takeIf { it >= 0L },
        )
    }

    suspend fun forEachChunk(
        context: Context,
        uri: Uri,
        chunkSize: Int = 64 * 1024,
        skipBytes: Long = 0L,
        onChunk: suspend (chunk: ByteArray) -> Unit,
    ): Long = withContext(Dispatchers.IO) {
        require(chunkSize > 0) { "chunkSize must be > 0" }
        val resolver = context.contentResolver
        resolver.openInputStream(uri)?.use { input ->
            val safeSkip = skipBytes.coerceAtLeast(0L)
            if (safeSkip > 0) {
                var remaining = safeSkip
                val discard = ByteArray(minOf(chunkSize, 16 * 1024))
                while (remaining > 0) {
                    val n = input.read(discard, 0, minOf(discard.size.toLong(), remaining).toInt())
                    if (n <= 0) break
                    remaining -= n
                }
            }

            var emitted = safeSkip
            val buffer = ByteArray(chunkSize)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                val chunk = if (n == buffer.size) buffer.copyOf() else buffer.copyOfRange(0, n)
                onChunk(chunk)
                emitted += n
            }
            emitted
        } ?: throw IllegalStateException(context.getString(R.string.file_utils_error_read_stream, uri))
    }

    suspend fun writeToShareCache(
        context: Context,
        fileName: String,
        bytes: ByteArray,
    ): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "shared-files")
        if (!dir.exists()) dir.mkdirs()
        val out = File(dir, sanitizeFileName(fileName))
        out.outputStream().use { it.write(bytes) }
        out
    }

    fun toShareUri(context: Context, file: File): Uri {
        return FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
    }

    fun sanitizeFileName(name: String): String {
        val cleaned = name.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_")
        return cleaned.ifBlank { "upload.bin" }
    }

    fun isImageLike(mimeType: String?, fileName: String): Boolean {
        if (!mimeType.isNullOrBlank() && mimeType.startsWith("image/")) return true
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return ext in setOf("png", "jpg", "jpeg", "webp", "bmp", "gif", "heic")
    }
}


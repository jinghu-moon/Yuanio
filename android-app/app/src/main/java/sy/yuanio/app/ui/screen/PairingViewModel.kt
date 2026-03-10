package sy.yuanio.app.ui.screen

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import sy.yuanio.app.R
import sy.yuanio.app.crypto.CryptoManager
import sy.yuanio.app.data.ApiClient
import sy.yuanio.app.data.KeyStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PairingViewModel(app: Application) : AndroidViewModel(app) {

    sealed class State {
        data object Idle : State()
        data object Loading : State()
        data object Success : State()
        data class Error(val message: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state = _state.asStateFlow()

    private val keyStore = KeyStore(app)

    val isPaired: Boolean get() = keyStore.isPaired

    fun pair(code: String, serverUrl: String, profileName: String = "default") {
        _state.value = State.Loading
        viewModelScope.launch {
            try {
                val normalizedServerUrl = serverUrl.trim()
                keyStore.activeProfile = profileName
                val kp = CryptoManager.generateKeyPair()
                val client = ApiClient(normalizedServerUrl)
                val result = client.joinPairing(code, CryptoManager.toBase64(kp.publicKey))

                val peerPub = CryptoManager.fromBase64(result.agentPublicKey)
                val shared = CryptoManager.deriveSharedKey(
                    kp.privateKey,
                    peerPub,
                    result.sessionId.toByteArray(),
                    CryptoManager.DEFAULT_E2EE_INFO.toByteArray(),
                )

                keyStore.save(
                    publicKey = kp.publicKey,
                    privateKey = kp.privateKey.encoded,
                    peerPublicKey = peerPub,
                    sharedKey = shared,
                    deviceId = result.deviceId,
                    sessionId = result.sessionId,
                    sessionToken = result.sessionToken,
                    serverUrl = normalizedServerUrl
                )
                _state.value = State.Success
            } catch (e: Exception) {
                _state.value = State.Error(toUserErrorMessage(e))
            }
        }
    }

    private fun toUserErrorMessage(e: Exception): String {
        val raw = e.message?.trim().orEmpty()
        val app = getApplication<Application>()
        if (raw.contains("CLEARTEXT communication", ignoreCase = true)) {
            return app.getString(R.string.pairing_error_cleartext_http)
        }
        if (raw.contains("Unable to resolve host", ignoreCase = true)) {
            return app.getString(R.string.pairing_error_resolve_host)
        }
        if (raw.contains("timeout", ignoreCase = true)) {
            return app.getString(R.string.pairing_error_timeout)
        }
        return if (raw.isNotBlank()) raw else app.getString(R.string.pairing_error_failed)
    }
}


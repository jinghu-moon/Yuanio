package sy.yuanio.app

import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import sy.yuanio.app.crypto.KeyDerivation
import sy.yuanio.app.crypto.VaultManager
import sy.yuanio.app.data.InteractionActionIntentPayload
import sy.yuanio.app.data.KeyStore
import sy.yuanio.app.data.PendingApprovalStore
import sy.yuanio.app.data.PendingInteractionActionStore
import sy.yuanio.app.data.sendInteractionAction
import sy.yuanio.app.data.sendApprovalResponse
import sy.yuanio.app.ui.navigation.YuanioNavGraph
import sy.yuanio.app.ui.screen.UnlockMode
import sy.yuanio.app.ui.screen.UnlockScreen
import sy.yuanio.app.ui.screen.VaultSetupScreen
import sy.yuanio.app.ui.theme.ThemePreference
import sy.yuanio.app.ui.theme.YuanioTheme
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : FragmentActivity() {

    private lateinit var keyStore: KeyStore
    private lateinit var vault: VaultManager

    private val pairedState = mutableStateOf(false)
    private val vaultState = mutableStateOf(VaultManager.VaultState.NOT_CONFIGURED)
    private val unlockInProgress = mutableStateOf(false)
    private val unlockMessage = mutableStateOf<String?>(null)
    private val failedAttemptsState = mutableIntStateOf(0)
    private val lockoutRemainingState = mutableLongStateOf(0L)

    private val setupInProgress = mutableStateOf(false)
    private val setupError = mutableStateOf<String?>(null)
    private var noneAutoUnlockAttempted = false

    private var lastBackgroundAt = 0L
    private var lockoutTickerJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        keyStore = KeyStore(this)
        vault = keyStore.vaultManager
        refreshState()

        ThemePreference.init(this)

        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )

        setContent {
            YuanioTheme {
                when {
                    vaultState.value == VaultManager.VaultState.LOCKED -> {
                        UnlockScreen(
                            primaryMode = when {
                                vault.credentialType == VaultManager.CredentialType.PATTERN -> UnlockMode.PATTERN
                                vault.isLegacyPinCredential -> UnlockMode.PIN
                                else -> UnlockMode.PASSWORD
                            },
                            biometricEnabled = vault.isBiometricEnabled(),
                            failedAttempts = failedAttemptsState.intValue,
                            lockoutRemainingMs = lockoutRemainingState.longValue,
                            statusMessage = unlockMessage.value,
                            inProgress = unlockInProgress.value,
                            onPasswordSubmit = { unlockWithCredential(it) },
                            onPatternSubmit = { nodes ->
                                unlockWithCredential(KeyDerivation.serializePattern(nodes))
                            },
                            onBiometricRequest = { unlockWithBiometric() },
                            onExit = { finish() },
                        )
                    }

                    !pairedState.value -> {
                        val navController = rememberNavController()
                        YuanioNavGraph(
                            navController = navController,
                            onPaired = {
                                setupError.value = null
                                unlockMessage.value = null
                                refreshState()
                            },
                            startPaired = false,
                        )
                    }

                    vaultState.value == VaultManager.VaultState.NOT_CONFIGURED -> {
                        VaultSetupScreen(
                            biometricAvailable = isBiometricAvailable(),
                            isMigration = keyStore.needsVaultMigration,
                            inProgress = setupInProgress.value,
                            errorMessage = setupError.value,
                            onSetup = { credential, type, enableBiometric ->
                                setupVault(credential, type, enableBiometric)
                            },
                            onCancel = { finish() },
                        )
                    }

                    else -> {
                        val navController = rememberNavController()
                        YuanioNavGraph(
                            navController = navController,
                            onPaired = { refreshState() },
                            startPaired = true,
                        )
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (vault.state == VaultManager.VaultState.UNLOCKED) {
            val timeout = vault.autoLockTimeoutMs
            if (timeout == 0L) {
                vault.lock()
            } else if (timeout > 0L && lastBackgroundAt > 0L) {
                val elapsed = SystemClock.elapsedRealtime() - lastBackgroundAt
                if (elapsed >= timeout) vault.lock()
            }
        }
        refreshState()
    }

    override fun onStop() {
        super.onStop()
        lockoutTickerJob?.cancel()
        if (vault.state == VaultManager.VaultState.UNLOCKED) {
            lastBackgroundAt = SystemClock.elapsedRealtime()
            if (vault.autoLockTimeoutMs == 0L) {
                vault.lock()
                refreshState()
            }
        }
    }

    override fun onDestroy() {
        lockoutTickerJob?.cancel()
        super.onDestroy()
    }

    private fun setupVault(
        credential: String,
        type: VaultManager.CredentialType,
        enableBiometric: Boolean,
    ) {
        if (setupInProgress.value) return
        setupInProgress.value = true
        setupError.value = null

        lifecycleScope.launch(Dispatchers.Default) {
            val ok = keyStore.migrateToVault(
                credential = credential,
                type = type,
                enableBiometric = enableBiometric,
            )
            withContext(Dispatchers.Main) {
                setupInProgress.value = false
                if (ok) {
                    setupError.value = null
                    unlockMessage.value = null
                    refreshState()
                } else {
                    setupError.value = getString(R.string.vault_setup_failed)
                    refreshState()
                }
            }
        }
    }

    private fun unlockWithCredential(credential: String) {
        if (unlockInProgress.value) return
        unlockInProgress.value = true
        unlockMessage.value = null

        lifecycleScope.launch(Dispatchers.Default) {
            val ok = vault.unlock(credential, keyStore.activeProfile)
            withContext(Dispatchers.Main) {
                unlockInProgress.value = false
                refreshState()
                if (ok) {
                    unlockMessage.value = null
                    flushPendingApprovals()
                    flushPendingInteractionActions()
                } else {
                    val lockMs = lockoutRemainingState.longValue
                    unlockMessage.value = if (lockMs > 0L) {
                        getString(R.string.unlock_error_too_many_attempts)
                    } else {
                        getString(R.string.unlock_error_invalid_credential)
                    }
                }
            }
        }
    }

    private fun unlockWithBiometric() {
        if (unlockInProgress.value) return
        if (!vault.isBiometricEnabled()) {
            unlockMessage.value = getString(R.string.unlock_error_biometric_not_enabled)
            return
        }

        val cryptoObject = vault.getBiometricCryptoObject()
        if (cryptoObject == null) {
            unlockMessage.value = getString(R.string.unlock_error_biometric_invalid)
            return
        }

        unlockInProgress.value = true
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val cipher = result.cryptoObject?.cipher
                    if (cipher == null) {
                        unlockInProgress.value = false
                        unlockMessage.value = getString(R.string.unlock_error_biometric_failed)
                        return
                    }

                    lifecycleScope.launch(Dispatchers.Default) {
                        val kek = vault.decryptKekWithBiometric(cipher)
                        val ok = kek != null && vault.unlockWithKek(kek, keyStore.activeProfile)
                        if (kek != null) kek.fill(0)

                        withContext(Dispatchers.Main) {
                            unlockInProgress.value = false
                            refreshState()
                            if (ok) {
                                unlockMessage.value = null
                                flushPendingApprovals()
                                flushPendingInteractionActions()
                            } else {
                                unlockMessage.value = getString(R.string.unlock_error_biometric_not_passed)
                            }
                        }
                    }
                }

                override fun onAuthenticationFailed() {
                    unlockMessage.value = getString(R.string.unlock_error_biometric_retry)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    unlockInProgress.value = false
                    unlockMessage.value = when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> getString(R.string.unlock_biometric_canceled)

                        else -> errString.toString()
                    }
                }
            }
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(getString(R.string.app_name))
            .setSubtitle(getString(R.string.unlock_biometric_prompt_subtitle))
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(getString(R.string.common_cancel))
            .build()

        prompt.authenticate(promptInfo, cryptoObject)
    }

    private fun flushPendingApprovals() {
        val store = PendingApprovalStore(this)
        val pending = store.drain()
        if (pending.isEmpty()) return
        pending.forEach { item ->
            sendApprovalResponse(applicationContext, item.approvalId, item.approved)
        }
    }

    private fun flushPendingInteractionActions() {
        val store = PendingInteractionActionStore(this)
        val pending = store.drain()
        if (pending.isEmpty()) return
        pending.forEach { item ->
            sendInteractionAction(
                context = applicationContext,
                payload = InteractionActionIntentPayload(
                    action = item.action,
                    approvalId = item.approvalId,
                    taskId = item.taskId,
                    path = item.path,
                    prompt = item.prompt,
                    reason = item.reason,
                )
            )
        }
    }

    private fun refreshState() {
        pairedState.value = keyStore.isPaired
        vaultState.value = vault.state
        failedAttemptsState.intValue = vault.failedAttempts
        lockoutRemainingState.longValue = vault.lockoutRemainingMs
        ensureLockoutTicker()

        if (vaultState.value != VaultManager.VaultState.LOCKED || vault.credentialType != VaultManager.CredentialType.NONE) {
            noneAutoUnlockAttempted = false
        }
        if (
            vaultState.value == VaultManager.VaultState.LOCKED &&
            vault.credentialType == VaultManager.CredentialType.NONE &&
            !unlockInProgress.value &&
            !noneAutoUnlockAttempted
        ) {
            noneAutoUnlockAttempted = true
            unlockMessage.value = getString(R.string.unlock_none_entering)
            unlockWithCredential(VaultManager.NONE_CREDENTIAL)
        }
    }

    private fun ensureLockoutTicker() {
        val remaining = lockoutRemainingState.longValue
        val needTicker = vaultState.value == VaultManager.VaultState.LOCKED && remaining > 0L
        if (!needTicker) {
            lockoutTickerJob?.cancel()
            lockoutTickerJob = null
            return
        }
        if (lockoutTickerJob?.isActive == true) return

        lockoutTickerJob = lifecycleScope.launch(Dispatchers.Main) {
            while (isActive) {
                val nowRemaining = vault.lockoutRemainingMs
                lockoutRemainingState.longValue = nowRemaining
                if (nowRemaining <= 0L) {
                    break
                }
                delay(1_000L)
            }
            lockoutTickerJob = null
            // 倒计时结束后拉一次完整状态，避免 UI 残留旧提示
            refreshState()
        }
    }

    private fun isBiometricAvailable(): Boolean {
        val manager = BiometricManager.from(this)
        return manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }
}


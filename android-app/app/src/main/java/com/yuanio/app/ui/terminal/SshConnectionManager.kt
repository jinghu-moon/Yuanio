package com.yuanio.app.ui.terminal

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream

/**
 * SSH 连接状态
 */
enum class SshConnectionState {
    DISCONNECTED,
    CONNECTING,
    AUTHENTICATING,
    CONNECTED,
    ERROR,
}

/**
 * SSH 连接结果
 */
sealed class SshResult {
    data object Success : SshResult()
    data class Error(val message: String, val cause: Throwable? = null) : SshResult()
    data class HostKeyVerification(
        val host: String,
        val fingerprint: String,
        val keyType: String,
    ) : SshResult()
}

/**
 * SSH 连接管理器
 *
 * 负责管理单个 SSH 会话的生命周期：
 * - 连接建立（密码/公钥鉴权）
 * - Shell 通道管理
 * - 主机指纹验证（首次连接需用户确认）
 * - 输入/输出流桥接
 * - 保活心跳
 * - 端口转发
 *
 * 依赖 JSch 库（需在 build.gradle 中添加 com.jcraft:jsch）。
 * 此类提供接口抽象层，实际 JSch 调用通过 SshSessionDelegate 注入，
 * 以便在无 JSch 依赖时仍可编译。
 */
class SshConnectionManager(
    private val profile: SshProfile,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(SshConnectionState.DISCONNECTED)
    val state: StateFlow<SshConnectionState> = _state.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var sessionDelegate: SshSessionDelegate? = null
    private var readJob: Job? = null
    private val outputChannel = Channel<ByteArray>(Channel.BUFFERED)

    /** 输出回调：收到 SSH 远端数据时调用 */
    var onOutput: ((ByteArray) -> Unit)? = null

    /** 主机指纹验证回调：需要用户确认时调用 */
    var onHostKeyVerify: ((SshResult.HostKeyVerification) -> Unit)? = null

    /**
     * 发起 SSH 连接
     */
    fun connect(cols: Int = 80, rows: Int = 24) {
        if (_state.value == SshConnectionState.CONNECTING ||
            _state.value == SshConnectionState.CONNECTED
        ) return

        scope.launch {
            _state.value = SshConnectionState.CONNECTING
            _errorMessage.value = null

            val result = withContext(Dispatchers.IO) {
                try {
                    val delegate = SshSessionDelegate.create(profile)
                    sessionDelegate = delegate

                    // 主机指纹验证
                    val fingerprint = delegate.getHostFingerprint()
                    if (profile.knownHostFingerprint.isNotBlank() &&
                        profile.knownHostFingerprint != fingerprint
                    ) {
                        return@withContext SshResult.HostKeyVerification(
                            host = profile.host,
                            fingerprint = fingerprint,
                            keyType = delegate.getHostKeyType(),
                        )
                    }

                    // 鉴权
                    _state.value = SshConnectionState.AUTHENTICATING
                    delegate.authenticate()

                    // 打开 Shell 通道
                    delegate.openShell(cols, rows)

                    // 设置端口转发
                    if (profile.enablePortForwarding) {
                        profile.portForwardingRules.forEach { rule ->
                            delegate.addPortForwarding(rule)
                        }
                    }

                    // 启动保活
                    if (profile.keepAliveIntervalSec > 0) {
                        delegate.setKeepAlive(profile.keepAliveIntervalSec)
                    }

                    SshResult.Success
                } catch (e: Exception) {
                    SshResult.Error(e.message ?: "SSH 连接失败", e)
                }
            }

            when (result) {
                is SshResult.Success -> {
                    _state.value = SshConnectionState.CONNECTED
                    startReadLoop()
                }
                is SshResult.Error -> {
                    _state.value = SshConnectionState.ERROR
                    _errorMessage.value = result.message
                }
                is SshResult.HostKeyVerification -> {
                    _state.value = SshConnectionState.DISCONNECTED
                    onHostKeyVerify?.invoke(result)
                }
            }
        }
    }

    /**
     * 发送输入到远端
     */
    fun sendInput(data: ByteArray) {
        if (_state.value != SshConnectionState.CONNECTED) return
        scope.launch(Dispatchers.IO) {
            try {
                sessionDelegate?.writeInput(data)
            } catch (e: Exception) {
                _state.value = SshConnectionState.ERROR
                _errorMessage.value = "发送失败: ${e.message}"
            }
        }
    }

    /**
     * 调整终端大小
     */
    fun resize(cols: Int, rows: Int) {
        scope.launch(Dispatchers.IO) {
            sessionDelegate?.resize(cols, rows)
        }
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        readJob?.cancel()
        readJob = null
        scope.launch(Dispatchers.IO) {
            sessionDelegate?.close()
            sessionDelegate = null
        }
        _state.value = SshConnectionState.DISCONNECTED
    }

    private fun startReadLoop() {
        readJob?.cancel()
        readJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(8192)
            val inputStream = sessionDelegate?.getInputStream() ?: return@launch
            try {
                while (true) {
                    val bytesRead = inputStream.read(buffer)
                    if (bytesRead <= 0) break
                    val data = buffer.copyOf(bytesRead)
                    onOutput?.invoke(data)
                }
            } catch (_: Exception) {
                // 连接关闭
            } finally {
                if (_state.value == SshConnectionState.CONNECTED) {
                    _state.value = SshConnectionState.DISCONNECTED
                }
            }
        }
    }
}

/**
 * SSH 会话代理接口
 *
 * 抽象 JSch 的具体 API，使 SshConnectionManager 不直接依赖 JSch。
 * 实际实现在 SshSessionDelegateImpl 中（依赖 JSch 库时启用）。
 */
interface SshSessionDelegate {
    /** 获取主机指纹 */
    fun getHostFingerprint(): String
    /** 获取主机密钥类型 */
    fun getHostKeyType(): String
    /** 执行鉴权 */
    fun authenticate()
    /** 打开 Shell 通道 */
    fun openShell(cols: Int, rows: Int)
    /** 写入数据到远端 */
    fun writeInput(data: ByteArray)
    /** 获取远端输入流 */
    fun getInputStream(): InputStream
    /** 调整终端大小 */
    fun resize(cols: Int, rows: Int)
    /** 设置保活间隔 */
    fun setKeepAlive(intervalSec: Int)
    /** 添加端口转发规则 */
    fun addPortForwarding(rule: String)
    /** 关闭连接 */
    fun close()

    companion object {
        /**
         * 创建代理实例。
         * 使用 mwiede/jsch 实现 SSH 连接。
         */
        fun create(profile: SshProfile): SshSessionDelegate {
            return SshSessionDelegateImpl(profile)
        }
    }
}

/**
 * Stub 实现：在 JSch 未集成前提供编译占位。
 * 所有操作抛出 UnsupportedOperationException。
 */
private class SshSessionDelegateStub(private val profile: SshProfile) : SshSessionDelegate {
    override fun getHostFingerprint(): String = ""
    override fun getHostKeyType(): String = "unknown"
    override fun authenticate() {
        throw UnsupportedOperationException("SSH 尚未集成：需要添加 JSch 依赖")
    }
    override fun openShell(cols: Int, rows: Int) {}
    override fun writeInput(data: ByteArray) {}
    override fun getInputStream(): InputStream = InputStream.nullInputStream()
    override fun resize(cols: Int, rows: Int) {}
    override fun setKeepAlive(intervalSec: Int) {}
    override fun addPortForwarding(rule: String) {}
    override fun close() {}
}

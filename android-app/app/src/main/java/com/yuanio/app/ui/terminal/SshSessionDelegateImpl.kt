package com.yuanio.app.ui.terminal

import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

/**
 * 基于 mwiede/jsch 的 SSH 会话代理实现。
 *
 * 特性：
 * - 支持密码、公钥、双因子三种鉴权方式
 * - 支持 Ed25519 / ECDSA / RSA 密钥
 * - Shell PTY 通道管理
 * - 保活心跳
 * - 本地端口转发
 * - 主机指纹验证（SHA-256）
 */
class SshSessionDelegateImpl(private val profile: SshProfile) : SshSessionDelegate {

    private val jsch = JSch()
    private var session: Session? = null
    private var channel: ChannelShell? = null
    private var outputStream: OutputStream? = null

    init {
        // 如果有私钥，添加到 JSch
        if (profile.authMethod == SshAuthMethod.PUBLIC_KEY ||
            profile.authMethod == SshAuthMethod.KEY_AND_PASSWORD
        ) {
            if (profile.privateKeyAlias.isNotBlank()) {
                // 私钥可能是文件路径或内联内容
                val passphrase = profile.privateKeyPassphrase.takeIf { it.isNotBlank() }
                    ?.toByteArray()
                try {
                    jsch.addIdentity(
                        profile.privateKeyAlias,       // 别名
                        profile.privateKeyAlias.toByteArray(), // 私钥内容
                        null,                          // 公钥（可选）
                        passphrase,
                    )
                } catch (_: Exception) {
                    // 回退：尝试作为文件路径加载
                    jsch.addIdentity(
                        profile.privateKeyAlias,
                        passphrase?.let { String(it) },
                    )
                }
            }
        }
    }

    override fun getHostFingerprint(): String {
        val tempSession = jsch.getSession(profile.username, profile.host, profile.port)
        tempSession.setConfig("StrictHostKeyChecking", "no")
        tempSession.timeout = profile.connectTimeoutMs

        // 仅用于获取指纹，连接后立即断开
        return try {
            tempSession.connect(profile.connectTimeoutMs)
            val hostKey = tempSession.hostKey
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(hostKey.key.toByteArray())
            val fingerprint = hash.joinToString(":") { "%02x".format(it) }
            tempSession.disconnect()
            "SHA256:$fingerprint"
        } catch (e: Exception) {
            ""
        }
    }

    override fun getHostKeyType(): String {
        return session?.hostKey?.type ?: "unknown"
    }

    override fun authenticate() {
        val s = jsch.getSession(profile.username, profile.host, profile.port)
        session = s

        // 禁用主机密钥检查（由上层 SshConnectionManager 处理指纹验证）
        s.setConfig("StrictHostKeyChecking", "no")
        s.timeout = profile.connectTimeoutMs

        // 设置环境变量
        profile.envVars.forEach { (k, v) ->
            s.setConfig(k, v)
        }

        // 密码鉴权
        if (profile.authMethod == SshAuthMethod.PASSWORD ||
            profile.authMethod == SshAuthMethod.KEY_AND_PASSWORD
        ) {
            s.setPassword(profile.password)
        }

        // 连接
        s.connect(profile.connectTimeoutMs)
    }

    override fun openShell(cols: Int, rows: Int) {
        val s = session ?: throw IllegalStateException("未连接")
        val ch = s.openChannel("shell") as ChannelShell
        channel = ch

        // 设置 PTY 参数
        ch.setPtyType("xterm-256color", cols, rows, cols * 8, rows * 16)

        // 设置环境变量（通过 Channel）
        profile.envVars.forEach { (k, v) ->
            ch.setEnv(k, v)
        }

        ch.connect(profile.connectTimeoutMs)
        outputStream = ch.outputStream
    }

    override fun writeInput(data: ByteArray) {
        outputStream?.write(data)
        outputStream?.flush()
    }

    override fun getInputStream(): InputStream {
        return channel?.inputStream
            ?: throw IllegalStateException("Shell 通道未打开")
    }

    override fun resize(cols: Int, rows: Int) {
        channel?.setPtySize(cols, rows, cols * 8, rows * 16)
    }

    override fun setKeepAlive(intervalSec: Int) {
        session?.setServerAliveInterval(intervalSec * 1000)
        session?.setServerAliveCountMax(3)
    }

    override fun addPortForwarding(rule: String) {
        // 格式: "localPort:remoteHost:remotePort"
        val parts = rule.split(":")
        if (parts.size != 3) return
        val localPort = parts[0].toIntOrNull() ?: return
        val remoteHost = parts[1]
        val remotePort = parts[2].toIntOrNull() ?: return
        session?.setPortForwardingL(localPort, remoteHost, remotePort)
    }

    override fun close() {
        channel?.disconnect()
        channel = null
        outputStream = null
        session?.disconnect()
        session = null
    }
}

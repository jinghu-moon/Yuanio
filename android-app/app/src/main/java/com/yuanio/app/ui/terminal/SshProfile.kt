package com.yuanio.app.ui.terminal

/**
 * SSH 连接鉴权方式
 */
enum class SshAuthMethod {
    /** 密码鉴权 */
    PASSWORD,
    /** 私钥鉴权 */
    PUBLIC_KEY,
    /** 密码 + 私钥 双因子 */
    KEY_AND_PASSWORD,
}

/**
 * SSH Profile 配置：保存 SSH 连接所需的全部参数。
 *
 * 与 TerminalProfile 配合使用：
 * - TerminalProfile.profileType == ProfileType.SSH 时，关联一个 SshProfile
 * - 通过 sshProfileId 关联
 */
data class SshProfile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int = 22,
    val username: String,
    val authMethod: SshAuthMethod = SshAuthMethod.PASSWORD,
    /** 密码（仅 PASSWORD / KEY_AND_PASSWORD 时使用） */
    val password: String = "",
    /** 私钥内容或 Android Keystore 别名（仅 PUBLIC_KEY / KEY_AND_PASSWORD） */
    val privateKeyAlias: String = "",
    /** 私钥密码（如果私钥有 passphrase） */
    val privateKeyPassphrase: String = "",
    /** 连接超时（毫秒） */
    val connectTimeoutMs: Int = 10_000,
    /** 保活间隔（秒），0 表示不启用 */
    val keepAliveIntervalSec: Int = 30,
    /** 远端默认 Shell（留空使用服务器默认） */
    val remoteShell: String = "",
    /** 是否启用端口转发 */
    val enablePortForwarding: Boolean = false,
    /** 本地端口转发规则列表，格式 "localPort:remoteHost:remotePort" */
    val portForwardingRules: List<String> = emptyList(),
    /** 已知主机指纹（首次连接后保存，用于验证） */
    val knownHostFingerprint: String = "",
    /** 连接时的初始环境变量 */
    val envVars: Map<String, String> = emptyMap(),
)

/**
 * Profile 类型（用于区分本地终端和 SSH 终端）
 */
enum class ProfileType {
    /** 本地终端（通过 Relay PTY 连接） */
    LOCAL,
    /** SSH 远程终端 */
    SSH,
}

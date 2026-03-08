/**
 * Relay Socket.IO 心跳参数：
 * - 缩短断链感知时间，降低失败重连等待。
 * - pingInterval + pingTimeout 控制在 60s 内，避免常见反向代理空闲超时冲突。
 */
export const RELAY_PING_INTERVAL_MS = 20_000;
export const RELAY_PING_TIMEOUT_MS = 20_000;

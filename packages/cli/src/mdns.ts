/**
 * mdns.ts — mDNS 服务注册/注销
 *
 * 使用 bonjour-service（纯 JS，Bun 兼容）在局域网注册 Agent 服务，
 * 使 Android 端可通过 NsdManager 自动发现。
 */

let bonjourInstance: any = null;
let publishedService: any = null;
let cleanupRegistered = false;

/**
 * 在 mDNS 上注册 Yuanio Agent 服务。
 *
 * - 服务类型：`_yuanio._tcp`
 * - 服务名：`Yuanio-Agent-{deviceId.slice(0,6)}`
 * - TXT 记录：`{ deviceId, version, proto }`
 */
export function publishService(port: number, deviceId: string): void {
  // 幂等：重复调用先注销旧服务
  unpublishService();

  try {
    // 动态 import — 懒加载避免影响不需要 mDNS 的场景
    const { Bonjour } = require("bonjour-service");
    bonjourInstance = new Bonjour();

    const serviceName = `Yuanio-Agent-${deviceId.slice(0, 6)}`;

    publishedService = bonjourInstance.publish({
      name: serviceName,
      type: "yuanio",    // bonjour-service 会自动加 _tcp，注册为 _yuanio._tcp
      port,
      txt: {
        deviceId,
        version: "0.1.0",
        proto: "ws+json+crypto",
        agent: "cli",
        channel: "local-ws",
        capabilities: "local-ws",
      },
    });

    console.log(`[mdns] 已注册服务: ${serviceName} port=${port}`);
  } catch (e: any) {
    console.warn(`[mdns] 注册失败 (bonjour-service 可能未安装): ${e?.message || e}`);
    return;
  }

  // 注册进程退出清理（只注册一次）
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    const gracefulCleanup = () => {
      unpublishService();
    };
    process.on("exit", gracefulCleanup);
    process.on("SIGTERM", gracefulCleanup);
    process.on("SIGINT", gracefulCleanup);
  }
}

/**
 * 注销 mDNS 服务（幂等）。
 */
export function unpublishService(): void {
  if (publishedService) {
    try {
      publishedService.stop?.();
    } catch {}
    publishedService = null;
  }
  if (bonjourInstance) {
    try {
      bonjourInstance.destroy?.();
    } catch {}
    bonjourInstance = null;
  }
  // 不打印日志：unpublish 可能在未 publish 时被调用
}

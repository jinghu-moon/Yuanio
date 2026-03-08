export function registerRemoteProcessCleanup(cleanup: () => void): void {
  process.on("exit", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

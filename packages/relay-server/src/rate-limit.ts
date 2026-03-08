// 内存滑动窗口速率限制器
const windows = new Map<string, number[]>();

const MAX_REQUESTS = 5;
const WINDOW_MS = 60_000; // 1 分钟

export function checkRateLimit(ip: string): boolean {
  return checkRateLimitWithWindow(ip, MAX_REQUESTS, WINDOW_MS);
}

export function checkRateLimitWithWindow(
  key: string,
  maxRequests: number = MAX_REQUESTS,
  windowMs: number = WINDOW_MS,
): boolean {
  const normalizedMax = Number.isFinite(maxRequests) ? Math.max(1, Math.floor(maxRequests)) : MAX_REQUESTS;
  const normalizedWindowMs = Number.isFinite(windowMs) ? Math.max(1_000, Math.floor(windowMs)) : WINDOW_MS;
  const now = Date.now();
  const timestamps = windows.get(key) ?? [];

  // 清除过期记录
  const valid = timestamps.filter((t) => now - t < normalizedWindowMs);
  valid.push(now);
  windows.set(key, valid);

  return valid.length <= normalizedMax;
}

// 定期清理过期 IP 条目（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of windows) {
    const valid = ts.filter((t) => now - t < WINDOW_MS);
    if (valid.length === 0) windows.delete(ip);
    else windows.set(ip, valid);
  }
}, 5 * 60_000);

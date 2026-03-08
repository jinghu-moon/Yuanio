// 双空格检测：在 stdin rawMode 下监听两次空格，间隔 < 300ms 触发切换
const DOUBLE_TAP_MS = 300;

export function watchDoubleSpace(onTrigger: () => void): () => void {
  let lastSpace = 0;

  const handler = (data: Buffer) => {
    // 空格键 = 0x20
    if (data.length === 1 && data[0] === 0x20) {
      const now = Date.now();
      if (now - lastSpace < DOUBLE_TAP_MS) {
        lastSpace = 0;
        onTrigger();
      } else {
        lastSpace = now;
      }
    } else {
      lastSpace = 0;
    }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handler);
  }

  // 返回清理函数
  return () => {
    process.stdin.removeListener("data", handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

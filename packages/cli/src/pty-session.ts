import * as pty from "node-pty";

// --- 输出批量合并（参考 VS Code PTY Host） ---
class OutputBuffer {
  private chunks: string[] = [];
  private timer: Timer | null = null;
  private byteCount = 0;
  private readonly FLUSH_INTERVAL = 50;  // ms
  private readonly FLUSH_SIZE = 16384;   // 16KB

  constructor(private onFlush: (data: string) => void) {}

  push(data: string) {
    this.chunks.push(data);
    this.byteCount += data.length;
    if (this.byteCount >= this.FLUSH_SIZE) { this.flush(); return; }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.chunks.length === 0) return;
    this.onFlush(this.chunks.join(""));
    this.chunks = [];
    this.byteCount = 0;
  }
}

// --- Shell 白名单（防止任意命令注入） ---
const ALLOWED_SHELLS = new Set(["bash", "zsh", "sh", "fish", "powershell.exe", "pwsh", "cmd.exe"]);

function validateShell(shell: string): string {
  const name = shell.split("/").pop()!;
  if (!ALLOWED_SHELLS.has(name)) throw new Error(`shell not allowed: ${name}`);
  return shell;
}

// --- 水位线流控（参考 VS Code ACK 反压） ---
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;
const PTY_IDLE_TIMEOUT = 30 * 60 * 1000; // 30min

type PtySession = {
  pty: pty.IPty;
  outputBuffer: OutputBuffer;
  unackedBytes: number;
  paused: boolean;
  idleTimer: Timer | null;
  pid: number;
  startedAt: number;
  lastActiveAt: number;
  cols: number;
  rows: number;
};

const sessions = new Map<string, PtySession>();

function resetIdleTimer(ptyId: string) {
  const session = sessions.get(ptyId);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => killPty(ptyId), PTY_IDLE_TIMEOUT);
}

export function spawnPty(
  ptyId: string,
  cols: number,
  rows: number,
  sendOutput: (ptyId: string, data: string) => void,
  onExit: (ptyId: string, code: number) => void,
  shell?: string,
  cwd?: string,
) {
  killPty(ptyId);
  const raw = shell || (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash");
  const s = validateShell(raw);

  const ptyInstance = pty.spawn(s, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: cwd || process.cwd(),
    env: process.env as Record<string, string>,
  });

  const now = Date.now();
  const session: PtySession = {
    pty: ptyInstance,
    outputBuffer: new OutputBuffer((data) => {
      session.unackedBytes += data.length;
      sendOutput(ptyId, data);
      if (!session.paused && session.unackedBytes >= HIGH_WATER) {
        session.pty.pause();
        session.paused = true;
        console.log(`[pty-flow] paused ${ptyId}, buffered=${(session.unackedBytes / 1024).toFixed(0)}KB`);
      }
    }),
    unackedBytes: 0,
    paused: false,
    idleTimer: null,
    pid: ptyInstance.pid,
    startedAt: now,
    lastActiveAt: now,
    cols,
    rows,
  };

  sessions.set(ptyId, session);

  ptyInstance.onData((data) => {
    session.lastActiveAt = Date.now();
    session.outputBuffer.push(data);
  });
  ptyInstance.onExit(({ exitCode }) => {
    killPty(ptyId);
    onExit(ptyId, exitCode);
  });

  resetIdleTimer(ptyId);
  console.log(`[pty] spawned: ${s} (${cols}x${rows}) id=${ptyId}`);
}

export function writePty(ptyId: string, data: string) {
  const session = sessions.get(ptyId);
  if (!session) return;
  session.lastActiveAt = Date.now();
  session.pty.write(data);
  resetIdleTimer(ptyId);
}

export function resizePty(ptyId: string, cols: number, rows: number) {
  const session = sessions.get(ptyId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;
  session.pty.resize(cols, rows);
}

export function ackPty(ptyId: string, bytes: number) {
  const session = sessions.get(ptyId);
  if (!session) return;
  session.unackedBytes = Math.max(0, session.unackedBytes - bytes);
  if (session.paused && session.unackedBytes <= LOW_WATER) {
    session.pty.resume();
    session.paused = false;
    console.log(`[pty-flow] resumed ${ptyId}, buffered=${(session.unackedBytes / 1024).toFixed(0)}KB`);
  }
}

export function killPty(ptyId: string) {
  const session = sessions.get(ptyId);
  if (!session) return;
  if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = null; }
  session.outputBuffer.flush();
  session.pty.kill();
  sessions.delete(ptyId);
  console.log(`[pty] killed id=${ptyId}`);
}

export function killAllPty() {
  for (const id of sessions.keys()) {
    killPty(id);
  }
}

export function hasPty(ptyId: string): boolean { return sessions.has(ptyId); }

export type PtyMetrics = {
  ptyId: string;
  pid: number;
  startedAt: number;
  lastActiveAt: number;
  cols: number;
  rows: number;
  bufferedBytes: number;
  paused: boolean;
};

export function getPtyMetrics(ptyId: string): PtyMetrics | null {
  const session = sessions.get(ptyId);
  if (!session) return null;
  return {
    ptyId,
    pid: session.pid,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    cols: session.cols,
    rows: session.rows,
    bufferedBytes: session.unackedBytes,
    paused: session.paused,
  };
}

export function listPtyMetrics(): PtyMetrics[] {
  const items: PtyMetrics[] = [];
  for (const [ptyId, session] of sessions.entries()) {
    items.push({
      ptyId,
      pid: session.pid,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      cols: session.cols,
      rows: session.rows,
      bufferedBytes: session.unackedBytes,
      paused: session.paused,
    });
  }
  return items;
}

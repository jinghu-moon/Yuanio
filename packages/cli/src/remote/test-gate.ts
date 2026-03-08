export interface TestGateRunInput {
  taskId: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface TestGateRunResult {
  taskId: string;
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function truncate(text: string, maxChars = 2400): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}\n...(truncated)`;
}

export function renderTestGateSummary(result: TestGateRunResult): string {
  const header = result.ok ? "自动测试通过" : "自动测试失败";
  const lines = [
    header,
    `task: ${result.taskId}`,
    `cmd: ${result.command}`,
    `cwd: ${result.cwd}`,
    `exit: ${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
    `duration: ${result.durationMs}ms`,
  ];
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout) {
    lines.push("", "stdout", "```text", truncate(stdout), "```");
  }
  if (stderr) {
    lines.push("", "stderr", "```text", truncate(stderr), "```");
  }
  return lines.join("\n");
}

export async function runTestGate(input: TestGateRunInput): Promise<TestGateRunResult> {
  const timeoutMs = Number.isFinite(input.timeoutMs) && (input.timeoutMs || 0) > 0
    ? Math.floor(input.timeoutMs as number)
    : 180_000;
  const startedAt = Date.now();
  const args = process.platform === "win32"
    ? ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", input.command]
    : ["sh", "-lc", input.command];
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.cwd,
    env: { ...process.env, TERM: "dumb" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch {}
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      ok: (typeof exitCode === "number" ? exitCode : 1) === 0 && !timedOut,
      command: input.command,
      cwd: input.cwd,
      exitCode: typeof exitCode === "number" ? exitCode : 1,
      timedOut,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      taskId: input.taskId,
    };
  } finally {
    clearTimeout(timer);
  }
}

import { spawnAgent, type AgentType } from "./spawn";

const DEFAULT_PREWARM_PROMPT = "ping";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface PrewarmOptions {
  agent: AgentType;
  prompt?: string;
  timeoutMs?: number;
  label?: string;
}

export async function prewarmAgent(options: PrewarmOptions): Promise<void> {
  const prompt = options.prompt ?? DEFAULT_PREWARM_PROMPT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = options.label ?? "prewarm";
  let firstLogged = false;
  const t0 = Date.now();

  const handle = spawnAgent(prompt, () => {
    if (!firstLogged) {
      firstLogged = true;
      console.log(`[${label}] first_output: ${Date.now() - t0}ms`);
    }
  }, { agent: options.agent });

  const timeout = setTimeout(() => {
    console.warn(`[${label}] 超时 ${timeoutMs}ms，结束预热`);
    handle.kill();
  }, timeoutMs);

  try {
    await handle.promise;
    if (!firstLogged) {
      console.log(`[${label}] finished: ${Date.now() - t0}ms`);
    }
  } catch (e: any) {
    console.warn(`[${label}] 预热失败: ${e?.message || e}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function startWarmLoop(options: {
  agent: AgentType;
  intervalMs: number;
  prompt?: string;
  timeoutMs?: number;
  label?: string;
}) {
  let running = false;
  const label = options.label ?? "daemon-warm";

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      await prewarmAgent({
        agent: options.agent,
        prompt: options.prompt,
        timeoutMs: options.timeoutMs,
        label,
      });
    } finally {
      running = false;
    }
  };

  runOnce().catch(() => {});
  const timer = setInterval(runOnce, options.intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

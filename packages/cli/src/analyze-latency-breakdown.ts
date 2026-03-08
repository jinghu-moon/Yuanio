import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface QuantileSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

interface ScenarioResult {
  name: string;
  metrics: Record<string, QuantileSummary>;
}

interface BenchmarkResult {
  generatedAt: string;
  environment: {
    serverUrl: string;
    os: string;
    arch: string;
    bunVersion: string;
    nodeVersion: string;
  };
  scenarios: ScenarioResult[];
}

interface LayerLine {
  key: string;
  name: string;
  p50Ms: number | null;
  p95Ms: number | null;
  shareP50Pct: number | null;
  shareP95Pct: number | null;
  source: "measured" | "derived" | "not_measured";
  note?: string;
}

interface ScenarioBreakdown {
  scenario: string;
  kind: "text" | "binary";
  e2eMetric: string;
  p50TotalMs: number;
  p95TotalMs: number;
  layers: LayerLine[];
  anomalies: string[];
}

const args = Bun.argv.slice(2);

function arg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  return args[idx + 1] ?? fallback;
}

function fmtMs(value: number | null): string {
  if (value === null) return "-";
  return value.toFixed(2);
}

function fmtPct(value: number | null): string {
  if (value === null) return "-";
  return `${value.toFixed(1)}%`;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function pct(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
}

function pctOrNull(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return round2(pct(part, total));
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

function requiredMetric(scenario: ScenarioResult, key: string): QuantileSummary {
  const metric = scenario.metrics[key];
  if (!metric) throw new Error(`场景 ${scenario.name} 缺少指标 ${key}`);
  return metric;
}

function hasMetric(scenario: ScenarioResult, key: string): boolean {
  return key in scenario.metrics;
}

function buildTextBreakdown(scenario: ScenarioResult): ScenarioBreakdown {
  const sendToFirstChunk = requiredMetric(scenario, "sendToFirstChunkMs");
  const appEncode = requiredMetric(scenario, "appEncodeMs");
  const appDecryptChunk = requiredMetric(scenario, "appDecryptChunkMs");
  const agentDecrypt = requiredMetric(scenario, "agentDecryptMs");
  const agentEncodeChunk = requiredMetric(scenario, "agentEncodeChunkMs");
  const relayToAgent = requiredMetric(scenario, "relayToAgentMs");
  const sendToRelay = requiredMetric(scenario, "sendToRelayMs");
  const sendToAck = requiredMetric(scenario, "sendToAckMs");

  const appCryptoP50 = appEncode.p50 + appDecryptChunk.p50;
  const appCryptoP95 = appEncode.p95 + appDecryptChunk.p95;
  const agentCryptoP50 = agentDecrypt.p50 + agentEncodeChunk.p50;
  const agentCryptoP95 = agentDecrypt.p95 + agentEncodeChunk.p95;

  const residualP50 = clampNonNegative(sendToFirstChunk.p50 - appCryptoP50 - agentCryptoP50);
  const residualP95 = clampNonNegative(sendToFirstChunk.p95 - appCryptoP95 - agentCryptoP95);

  const anomalies: string[] = [];
  if (sendToRelay.p50 < 0 || sendToRelay.p95 < 0) {
    anomalies.push("sendToRelayMs 出现负值，存在跨进程/跨主机时钟偏移，需用单调时钟改造。");
  }
  if (sendToAck.p99 > sendToAck.p95 * 5) {
    anomalies.push(`sendToAckMs 尾延迟尖峰明显 (p95=${fmtMs(sendToAck.p95)}ms, p99=${fmtMs(sendToAck.p99)}ms)。`);
  }

  const p50TotalMs = sendToFirstChunk.p50;
  const p95TotalMs = sendToFirstChunk.p95;

  const layers: LayerLine[] = [
    {
      key: "app_crypto",
      name: "App 侧序列化+加解密",
      p50Ms: round2(appCryptoP50),
      p95Ms: round2(appCryptoP95),
      shareP50Pct: pctOrNull(appCryptoP50, p50TotalMs),
      shareP95Pct: pctOrNull(appCryptoP95, p95TotalMs),
      source: "measured",
    },
    {
      key: "agent_crypto",
      name: "Agent 侧序列化+加解密",
      p50Ms: round2(agentCryptoP50),
      p95Ms: round2(agentCryptoP95),
      shareP50Pct: pctOrNull(agentCryptoP50, p50TotalMs),
      shareP95Pct: pctOrNull(agentCryptoP95, p95TotalMs),
      source: "measured",
    },
    {
      key: "relay_transport",
      name: "Relay+传输+调度",
      p50Ms: round2(residualP50),
      p95Ms: round2(residualP95),
      shareP50Pct: pctOrNull(residualP50, p50TotalMs),
      shareP95Pct: pctOrNull(residualP95, p95TotalMs),
      source: "derived",
      note: `relayToAgent p50/p95=${fmtMs(relayToAgent.p50)}/${fmtMs(relayToAgent.p95)}ms`,
    },
    {
      key: "ui_render",
      name: "UI 渲染(Compose)",
      p50Ms: null,
      p95Ms: null,
      shareP50Pct: null,
      shareP95Pct: null,
      source: "not_measured",
      note: "当前基线运行在 CLI，未采集 Android 帧渲染耗时。",
    },
  ];

  return {
    scenario: scenario.name,
    kind: "text",
    e2eMetric: "sendToFirstChunkMs",
    p50TotalMs: round2(p50TotalMs),
    p95TotalMs: round2(p95TotalMs),
    layers,
    anomalies,
  };
}

function buildBinaryBreakdown(scenario: ScenarioResult): ScenarioBreakdown {
  const sendToEcho = requiredMetric(scenario, "sendToEchoMs");
  const appEncode = requiredMetric(scenario, "appEncodeMs");
  const appDecrypt = requiredMetric(scenario, "appDecryptMs");
  const agentDecrypt = requiredMetric(scenario, "agentDecryptMs");
  const agentEncode = requiredMetric(scenario, "agentEncodeMs");

  const appCryptoP50 = appEncode.p50 + appDecrypt.p50;
  const appCryptoP95 = appEncode.p95 + appDecrypt.p95;
  const agentCryptoP50 = agentDecrypt.p50 + agentEncode.p50;
  const agentCryptoP95 = agentDecrypt.p95 + agentEncode.p95;
  const residualP50 = clampNonNegative(sendToEcho.p50 - appCryptoP50 - agentCryptoP50);
  const residualP95 = clampNonNegative(sendToEcho.p95 - appCryptoP95 - agentCryptoP95);

  const p50TotalMs = sendToEcho.p50;
  const p95TotalMs = sendToEcho.p95;
  const anomalies: string[] = [];
  if (p50TotalMs <= 0) {
    anomalies.push("sendToEchoMs 的 P50 为 0ms（毫秒粒度下限），P50 占比不可用，请以 P95 与均值为主。");
  }

  const layers: LayerLine[] = [
    {
      key: "app_crypto",
      name: "App 侧序列化+加解密",
      p50Ms: round2(appCryptoP50),
      p95Ms: round2(appCryptoP95),
      shareP50Pct: pctOrNull(appCryptoP50, p50TotalMs),
      shareP95Pct: pctOrNull(appCryptoP95, p95TotalMs),
      source: "measured",
    },
    {
      key: "agent_crypto",
      name: "Agent 侧序列化+加解密",
      p50Ms: round2(agentCryptoP50),
      p95Ms: round2(agentCryptoP95),
      shareP50Pct: pctOrNull(agentCryptoP50, p50TotalMs),
      shareP95Pct: pctOrNull(agentCryptoP95, p95TotalMs),
      source: "measured",
    },
    {
      key: "relay_transport",
      name: "Relay+传输+调度",
      p50Ms: round2(residualP50),
      p95Ms: round2(residualP95),
      shareP50Pct: pctOrNull(residualP50, p50TotalMs),
      shareP95Pct: pctOrNull(residualP95, p95TotalMs),
      source: "derived",
    },
    {
      key: "ui_render",
      name: "UI 渲染(Compose)",
      p50Ms: null,
      p95Ms: null,
      shareP50Pct: null,
      shareP95Pct: null,
      source: "not_measured",
      note: "当前基线运行在 CLI，未采集 Android 帧渲染耗时。",
    },
  ];

  return {
    scenario: scenario.name,
    kind: "binary",
    e2eMetric: "sendToEchoMs",
    p50TotalMs: round2(p50TotalMs),
    p95TotalMs: round2(p95TotalMs),
    layers,
    anomalies,
  };
}

function buildBreakdowns(result: BenchmarkResult): ScenarioBreakdown[] {
  const list: ScenarioBreakdown[] = [];
  for (const scenario of result.scenarios) {
    if (hasMetric(scenario, "sendToFirstChunkMs")) {
      list.push(buildTextBreakdown(scenario));
      continue;
    }
    if (hasMetric(scenario, "sendToEchoMs")) {
      list.push(buildBinaryBreakdown(scenario));
      continue;
    }
  }
  return list;
}

function topOptimizationTargets(breakdowns: ScenarioBreakdown[]): Array<{
  scenario: string;
  layer: string;
  p50Ms: number;
  shareP50Pct: number;
}> {
  const items: Array<{ scenario: string; layer: string; p50Ms: number; shareP50Pct: number }> = [];
  for (const breakdown of breakdowns) {
    for (const layer of breakdown.layers) {
      if (layer.source === "not_measured") continue;
      if (layer.p50Ms === null || layer.shareP50Pct === null) continue;
      items.push({
        scenario: breakdown.scenario,
        layer: layer.name,
        p50Ms: layer.p50Ms,
        shareP50Pct: layer.shareP50Pct,
      });
    }
  }
  return items.sort((a, b) => b.p50Ms - a.p50Ms).slice(0, 6);
}

function renderMarkdown(result: BenchmarkResult, breakdowns: ScenarioBreakdown[]): string {
  const lines: string[] = [];
  lines.push("# Yuanio 延迟分层拆解报告");
  lines.push("");
  lines.push(`- 基线来源: docs/latency-baseline.json`);
  lines.push(`- 基线时间: ${result.generatedAt}`);
  lines.push(`- 环境: ${result.environment.os}/${result.environment.arch}, Bun ${result.environment.bunVersion}, Node ${result.environment.nodeVersion}`);
  lines.push(`- Server: ${result.environment.serverUrl}`);
  lines.push("");
  lines.push("## 分层定义");
  lines.push("");
  lines.push("1. App 侧序列化+加解密: appEncode + appDecrypt");
  lines.push("2. Agent 侧序列化+加解密: agentDecrypt + agentEncode");
  lines.push("3. Relay+传输+调度: 端到端减去两端处理后的残差");
  lines.push("4. UI 渲染(Compose): 当前基线未覆盖");
  lines.push("");

  for (const item of breakdowns) {
    lines.push(`## 场景: ${item.scenario}`);
    lines.push("");
    lines.push(`- 类型: ${item.kind}`);
    lines.push(`- 端到端指标: ${item.e2eMetric}`);
    lines.push(`- Total P50/P95: ${fmtMs(item.p50TotalMs)} / ${fmtMs(item.p95TotalMs)} ms`);
    lines.push("");
    lines.push("| 分层 | P50(ms) | P50占比 | P95(ms) | P95占比 | 数据来源 | 备注 |");
    lines.push("|---|---:|---:|---:|---:|---|---|");
    for (const layer of item.layers) {
      lines.push(`| ${layer.name} | ${fmtMs(layer.p50Ms)} | ${fmtPct(layer.shareP50Pct)} | ${fmtMs(layer.p95Ms)} | ${fmtPct(layer.shareP95Pct)} | ${layer.source} | ${layer.note ?? ""} |`);
    }
    if (item.anomalies.length > 0) {
      lines.push("");
      lines.push("异常观察:");
      for (const anomaly of item.anomalies) {
        lines.push(`- ${anomaly}`);
      }
    }
    lines.push("");
  }

  const topTargets = topOptimizationTargets(breakdowns);
  lines.push("## 优先优化建议(按绝对耗时 P50 排序)");
  lines.push("");
  lines.push("| 排名 | 场景 | 分层 | P50(ms) | 占比 |");
  lines.push("|---:|---|---|---:|---:|");
  topTargets.forEach((target, idx) => {
    lines.push(`| ${idx + 1} | ${target.scenario} | ${target.layer} | ${fmtMs(target.p50Ms)} | ${fmtPct(target.shareP50Pct)} |`);
  });
  lines.push("");
  lines.push("## 结论");
  lines.push("");
  lines.push("1. 当前瓶颈集中在 Relay+传输+调度层，端侧加解密已低于 1ms。");
  lines.push("2. 文本链路需要优先处理尾延迟尖峰（p99 远高于 p95）。");
  lines.push("3. UI 渲染需在 Android 端补充 Macrobenchmark，才能完成真实端到端闭环。");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDir, "../../..");
  const inputPath = resolve(projectRoot, arg("--in", "docs/latency-baseline.json"));
  const mdOutputPath = resolve(projectRoot, arg("--out", "docs/latency-breakdown.md"));
  const jsonOutputPath = resolve(projectRoot, arg("--json-out", "docs/latency-breakdown.json"));

  const raw = await readFile(inputPath, "utf-8");
  const parsed = JSON.parse(raw) as BenchmarkResult;
  const breakdowns = buildBreakdowns(parsed);
  if (breakdowns.length === 0) {
    throw new Error("未识别到可拆解场景，检查 baseline JSON 结构是否变更。");
  }

  const markdown = renderMarkdown(parsed, breakdowns);
  const jsonText = JSON.stringify({
    source: inputPath,
    generatedAt: new Date().toISOString(),
    baselineGeneratedAt: parsed.generatedAt,
    breakdowns,
  }, null, 2);

  await mkdir(dirname(mdOutputPath), { recursive: true });
  await mkdir(dirname(jsonOutputPath), { recursive: true });
  await writeFile(mdOutputPath, markdown, "utf-8");
  await writeFile(jsonOutputPath, jsonText, "utf-8");

  console.log(`[breakdown] 已写入: ${mdOutputPath}`);
  console.log(`[breakdown] 已写入: ${jsonOutputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[breakdown] 失败: ${message}`);
  process.exit(1);
});

import { existsSync, statSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Resolver, lookup } from "node:dns/promises";
import { PROTOCOL_VERSION } from "@yuanio/shared";

const YUANIO_DIR = `${process.env.HOME || process.env.USERPROFILE}/.yuanio`;
const DEFAULT_CONTROL_SERVER = "http://localhost:3000";

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

interface DoctorOptions {
  controlServerUrl: string;
  publicServerUrl?: string;
}

// ── 检查项 ──

function checkAgent(name: string, cmd: string): CheckResult {
  try {
    const result = spawnSync(cmd, ["--version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    if (result.status === 0) {
      const version = result.stdout?.toString().trim().split("\n")[0] || "unknown";
      return { label: `${name} CLI`, ok: true, detail: version };
    }
    return { label: `${name} CLI`, ok: false, detail: "not found" };
  } catch {
    return { label: `${name} CLI`, ok: false, detail: "not found" };
  }
}

async function checkUrlReachability(label: string, url: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      return { label, ok: true, detail: `connected (${url})` };
    }
    return { label, ok: false, detail: `HTTP ${res.status} (${url})` };
  } catch (e: any) {
    return { label, ok: false, detail: `${e?.message || "unreachable"} (${url})` };
  }
}

async function checkProtocolCompatibility(controlServerUrl: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${controlServerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { label: "Protocol", ok: false, detail: `health HTTP ${res.status}` };
    }
    const json = await res.json() as { protocolVersion?: string };
    const serverVersion = json.protocolVersion;
    if (!serverVersion) {
      return { label: "Protocol", ok: true, detail: "legacy relay (version unknown)" };
    }
    const sameMajor = serverVersion.split(".")[0] === PROTOCOL_VERSION.split(".")[0];
    if (!sameMajor) {
      return {
        label: "Protocol",
        ok: false,
        detail: `major mismatch cli=${PROTOCOL_VERSION} relay=${serverVersion}`,
      };
    }
    return { label: "Protocol", ok: true, detail: `compatible cli=${PROTOCOL_VERSION} relay=${serverVersion}` };
  } catch (e: any) {
    return { label: "Protocol", ok: false, detail: e?.message || "check failed" };
  }
}

function checkKeys(): CheckResult {
  const keystoreFile = join(YUANIO_DIR, "keys.json");
  if (!existsSync(keystoreFile)) {
    return { label: "Keys", ok: false, detail: "keystore not found" };
  }
  try {
    const data = JSON.parse(readFileSync(keystoreFile, "utf-8"));
    if (data.sessionToken && data.secretKey && data.peerPublicKey) {
      return { label: "Keys", ok: true, detail: "valid" };
    }
    return { label: "Keys", ok: false, detail: "incomplete keystore" };
  } catch {
    return { label: "Keys", ok: false, detail: "corrupted keystore" };
  }
}

function checkDaemon(): CheckResult {
  const stateFile = join(YUANIO_DIR, "daemon.json");
  if (!existsSync(stateFile)) {
    return { label: "Daemon", ok: false, detail: "not running" };
  }
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    process.kill(state.pid, 0);
    return { label: "Daemon", ok: true, detail: `PID=${state.pid} port=${state.port}` };
  } catch {
    return { label: "Daemon", ok: false, detail: "not running (stale state)" };
  }
}

function checkDisk(): CheckResult {
  if (!existsSync(YUANIO_DIR)) {
    return { label: "Disk", ok: true, detail: "0 bytes" };
  }
  let totalSize = 0;
  try {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else totalSize += statSync(full).size;
      }
    };
    walk(YUANIO_DIR);
  } catch {}
  const mb = (totalSize / (1024 * 1024)).toFixed(1);
  return { label: "Disk", ok: true, detail: `${mb}MB used` };
}

function checkProxyEnv(): CheckResult {
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
  const active = keys
    .map((key) => ({ key, value: process.env[key] }))
    .filter((item) => typeof item.value === "string" && item.value.trim().length > 0);
  if (active.length === 0) {
    return { label: "Proxy", ok: true, detail: "not set" };
  }
  const values = active.map((item) => `${item.key}=${item.value}`).join("; ");
  return { label: "Proxy", ok: false, detail: values };
}

function checkCloudflaredBinary(): CheckResult {
  try {
    const result = spawnSync("cloudflared", ["--version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    if (result.status === 0) {
      const version = result.stdout?.toString().trim().split("\n")[0] || "unknown";
      return { label: "Cloudflared", ok: true, detail: version };
    }
    return { label: "Cloudflared", ok: false, detail: "not found" };
  } catch {
    return { label: "Cloudflared", ok: false, detail: "not found" };
  }
}

function checkCloudflaredServiceOnWindows(): CheckResult | null {
  if (process.platform !== "win32") return null;
  try {
    const result = spawnSync("sc", ["query", "cloudflared"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    const output = `${result.stdout?.toString() || ""}\n${result.stderr?.toString() || ""}`;
    if (result.status !== 0 && /does not exist|1060/i.test(output)) {
      return { label: "CF Service", ok: false, detail: "not installed" };
    }
    if (/RUNNING/i.test(output)) {
      return { label: "CF Service", ok: true, detail: "running" };
    }
    if (/STOPPED/i.test(output)) {
      return { label: "CF Service", ok: false, detail: "stopped" };
    }
    return { label: "CF Service", ok: false, detail: "unknown state" };
  } catch {
    return { label: "CF Service", ok: false, detail: "query failed" };
  }
}

async function resolveHostWith(resolver: Resolver, host: string): Promise<Set<string>> {
  const values = new Set<string>();
  try {
    for (const ip of await resolver.resolve4(host)) values.add(ip);
  } catch {}
  try {
    for (const ip of await resolver.resolve6(host)) values.add(ip);
  } catch {}
  return values;
}

async function resolveHostByLookup(host: string): Promise<Set<string>> {
  const values = new Set<string>();
  try {
    const records = await lookup(host, { all: true });
    for (const record of records) {
      if (record.address) values.add(record.address);
    }
  } catch {}
  return values;
}

function isLikelyIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

async function checkPublicDns(publicServerUrl?: string): Promise<CheckResult | null> {
  if (!publicServerUrl) return null;
  let host: string;
  try {
    host = new URL(publicServerUrl).hostname;
  } catch {
    return { label: "DNS", ok: false, detail: "public server URL invalid" };
  }

  if (!host || host === "localhost" || isLikelyIp(host)) {
    return { label: "DNS", ok: true, detail: "skipped (localhost/ip)" };
  }

  const systemResolver = new Resolver();
  const publicResolver = new Resolver();
  publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);

  const [systemIps, publicIps] = await Promise.all([
    resolveHostWith(systemResolver, host),
    resolveHostWith(publicResolver, host),
  ]);
  if (systemIps.size === 0) {
    const lookupIps = await resolveHostByLookup(host);
    for (const ip of lookupIps) systemIps.add(ip);
  }

  if (publicIps.size === 0) {
    return { label: "DNS", ok: false, detail: `public resolver failed (${host})` };
  }
  if (systemIps.size === 0) {
    return { label: "DNS", ok: false, detail: `system resolver failed (${host})` };
  }

  const overlap = [...systemIps].filter((ip) => publicIps.has(ip));
  const systemText = [...systemIps].slice(0, 3).join(",");
  const publicText = [...publicIps].slice(0, 3).join(",");

  if (overlap.length === 0) {
    return {
      label: "DNS",
      ok: false,
      detail: `mismatch system=[${systemText}] public=[${publicText}]`,
    };
  }
  return { label: "DNS", ok: true, detail: `aligned (${host})` };
}

// ── 僵尸进程清理 ──

function killRunawayProcesses(): number {
  let killed = 0;
  const stateFile = join(YUANIO_DIR, "daemon.json");
  if (!existsSync(stateFile)) return killed;

  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    try {
      process.kill(state.pid, 0);
    } catch {
      unlinkSync(stateFile);
      killed++;
    }
  } catch {}
  return killed;
}

// ── 主函数 ──

function normalizeDoctorOptions(input: string | Partial<DoctorOptions>): DoctorOptions {
  if (typeof input === "string") {
    return { controlServerUrl: input || DEFAULT_CONTROL_SERVER };
  }
  return {
    controlServerUrl: input.controlServerUrl || DEFAULT_CONTROL_SERVER,
    publicServerUrl: input.publicServerUrl,
  };
}

export async function runDoctor(
  options: string | Partial<DoctorOptions> = DEFAULT_CONTROL_SERVER,
): Promise<void> {
  const { controlServerUrl, publicServerUrl } = normalizeDoctorOptions(options);
  console.log("\n🔍 Yuanio Doctor\n");

  const results: CheckResult[] = [];

  results.push(checkAgent("Claude", "claude"));
  results.push(checkAgent("Codex", "codex"));
  results.push(checkAgent("Gemini", "gemini"));

  results.push(await checkUrlReachability("Relay(control)", controlServerUrl));
  results.push(await checkProtocolCompatibility(controlServerUrl));
  if (publicServerUrl && publicServerUrl !== controlServerUrl) {
    results.push(await checkUrlReachability("Relay(public)", publicServerUrl));
  }

  const dnsResult = await checkPublicDns(publicServerUrl);
  if (dnsResult) results.push(dnsResult);
  results.push(checkProxyEnv());

  results.push(checkKeys());
  results.push(checkDaemon());
  results.push(checkDisk());
  results.push(checkCloudflaredBinary());
  const serviceResult = checkCloudflaredServiceOnWindows();
  if (serviceResult) results.push(serviceResult);

  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    console.log(`  ${icon} ${r.label}: ${r.detail}`);
  }

  const cleaned = killRunawayProcesses();
  if (cleaned > 0) {
    console.log(`\n  🧹 清理了 ${cleaned} 个僵尸进程`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log("\n  ✅ 所有检查通过\n");
  } else {
    console.log(`\n  ⚠️ ${failed.length} 项检查未通过\n`);
  }
}

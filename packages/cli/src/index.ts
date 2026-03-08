import { deriveAesGcmKey, DEFAULT_E2EE_INFO, normalizeNamespace, PROTOCOL_VERSION } from "@yuanio/shared";
import { startPairing } from "./pair";
import { loadKeys, hasKeys } from "./keystore";
import { RelayClient } from "./relay-client";
import { setupRemoteMode } from "./remote";
import { startLocalMode } from "./local";
import { watchDoubleSpace } from "./mode-switch";
import { daemonStart, daemonStop, daemonStatus } from "./daemon";
import { prewarmAgent } from "./prewarm";
import type { AgentType } from "./spawn";

function resolveDefaultAgentFromEnv(): AgentType {
  const raw = process.env.YUANIO_DEFAULT_AGENT;
  if (raw === "claude" || raw === "codex" || raw === "gemini") return raw;
  return "codex";
}

const args = process.argv.slice(2);
const defaultAgent = resolveDefaultAgentFromEnv();
const serverUrl = args.includes("--server")
  ? args[args.indexOf("--server") + 1]
  : "http://localhost:3000";
const publicServerUrl = args.includes("--public-server")
  ? args[args.indexOf("--public-server") + 1]
  : serverUrl;
const forcePair = args.includes("--pair");
const continueSession = args.includes("--continue");
const resumeId = args.includes("--resume")
  ? args[args.indexOf("--resume") + 1]
  : null;
const prewarmEnabled = args.includes("--prewarm") || process.env.YUANIO_PREWARM === "1";
const prewarmAgentArg = args.includes("--prewarm-agent")
  ? args[args.indexOf("--prewarm-agent") + 1]
  : process.env.YUANIO_PREWARM_AGENT;
const prewarmPrompt = process.env.YUANIO_PREWARM_PROMPT;
const namespace = normalizeNamespace(
  args.includes("--namespace")
    ? args[args.indexOf("--namespace") + 1]
    : process.env.YUANIO_NAMESPACE,
);

// 子命令拦截
if (args[0] === "launch") {
  import("./launcher/index.tsx").then(({ startLauncher }) =>
    startLauncher(args.slice(1))
  ).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === "doctor") {
  import("./commands/doctor").then(({ runDoctor }) => runDoctor({
    controlServerUrl: serverUrl,
    publicServerUrl,
  }));
} else if (args[0] === "agent") {
  import("./commands/agent").then(({ runAgentCommand }) => runAgentCommand(args.slice(1), {
    serverUrl,
    namespace,
  })).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === "daemon") {
  const sub = args[1];
  if (sub === "start") {
    const warmFlag = args.includes("--warm") || process.env.YUANIO_DAEMON_WARM === "1";
    const warmAgent = args.includes("--warm-agent")
      ? args[args.indexOf("--warm-agent") + 1]
      : process.env.YUANIO_DAEMON_WARM_AGENT;
    const warmInterval = args.includes("--warm-interval")
      ? Number(args[args.indexOf("--warm-interval") + 1])
      : Number(process.env.YUANIO_DAEMON_WARM_INTERVAL_MIN || 0);
    daemonStart(serverUrl, {
      warmAgent: (warmAgent || (warmFlag ? defaultAgent : undefined)) as AgentType | undefined,
      warmIntervalMin: Number.isFinite(warmInterval) && warmInterval > 0 ? warmInterval : undefined,
    }).catch((e) => { console.error(e); process.exit(1); });
  } else if (sub === "stop") {
    daemonStop();
  } else if (sub === "status") {
    daemonStatus();
  } else {
    console.log("用法: yuanio daemon <start|stop|status> [--server URL] [--warm] [--warm-agent <claude|codex|gemini>] [--warm-interval <minutes>]");
    process.exit(1);
  }
} else {
  // 正常 CLI 流程
  main().catch((err) => {
    const msg = err?.message || String(err);
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("Unable to connect")) {
      console.error(`无法连接服务器 ${serverUrl}`);
      console.error("   请确认 relay server 已启动，或使用 --server <url> 指定控制地址");
      console.error("   若桌面端 DNS 受限，可使用: --server http://localhost:3000 --public-server <公网URL>");
    } else if (msg.includes("配对超时")) {
      console.error("配对超时（5分钟内未完成）");
      console.error("   请重新运行 --pair 获取新配对码");
    } else {
      console.error("启动失败:", msg);
    }
    process.exit(1);
  });
}

type Mode = "local" | "remote";

async function main() {
  // 1. 配对或加载已有密钥
  let sharedKey: CryptoKey;
  let deviceId: string;
  let sessionId: string;
  let sessionToken: string;

  if (forcePair) {
    const result = await startPairing(serverUrl, publicServerUrl, namespace);
    sharedKey = result.sharedKey;
    deviceId = result.deviceId;
    sessionId = result.sessionId;
    sessionToken = result.sessionToken;
  } else if (continueSession || resumeId) {
    // 显式恢复：必须有已保存的密钥
    if (!hasKeys()) {
      console.error("没有已保存的会话，请先使用 --pair 配对");
      process.exit(1);
    }
    const keys = loadKeys()!;
    if (keys.cryptoVersion !== "webcrypto") {
      console.error("检测到旧版密钥格式，请使用 --pair 重新配对");
      process.exit(1);
    }
    if (resumeId && keys.sessionId !== resumeId) {
      console.error(`会话 ${resumeId} 不匹配，当前保存的是 ${keys.sessionId}`);
      process.exit(1);
    }
    if (keys.protocolVersion && keys.protocolVersion.split(".")[0] !== PROTOCOL_VERSION.split(".")[0]) {
      console.error(`协议版本不兼容: 本地密钥=${keys.protocolVersion}, CLI=${PROTOCOL_VERSION}`);
      console.error("请使用 --pair 重新配对");
      process.exit(1);
    }
    if (keys.namespace && keys.namespace !== namespace) {
      console.error(`命名空间不匹配: 当前参数=${namespace}，本地密钥=${keys.namespace}`);
      console.error("请切换 --namespace，或使用 --pair 在新命名空间重新配对");
      process.exit(1);
    }
    if (keys.protocolVersion && keys.protocolVersion.split(".")[0] !== PROTOCOL_VERSION.split(".")[0]) {
      console.error(`协议版本不兼容: 本地密钥=${keys.protocolVersion}, CLI=${PROTOCOL_VERSION}`);
      console.error("请使用 --pair 重新配对");
      process.exit(1);
    }
    sharedKey = await deriveAesGcmKey({
      privateKey: keys.secretKey,
      publicKey: keys.peerPublicKey,
      salt: keys.sessionId,
      info: DEFAULT_E2EE_INFO,
    });
    deviceId = keys.deviceId;
    sessionId = keys.sessionId;
    sessionToken = keys.sessionToken;
    console.log(`恢复会话: ${sessionId.slice(0, 8)}...`);
  } else if (hasKeys()) {
    const keys = loadKeys()!;
    if (keys.cryptoVersion !== "webcrypto") {
      console.error("检测到旧版密钥格式，请使用 --pair 重新配对");
      process.exit(1);
    }
    if (keys.namespace && keys.namespace !== namespace) {
      console.error(`命名空间不匹配: 当前参数=${namespace}，本地密钥=${keys.namespace}`);
      console.error("请切换 --namespace，或使用 --pair 在新命名空间重新配对");
      process.exit(1);
    }
    sharedKey = await deriveAesGcmKey({
      privateKey: keys.secretKey,
      publicKey: keys.peerPublicKey,
      salt: keys.sessionId,
      info: DEFAULT_E2EE_INFO,
    });
    deviceId = keys.deviceId;
    sessionId = keys.sessionId;
    sessionToken = keys.sessionToken;
    console.log("已加载保存的密钥");
  } else {
    const result = await startPairing(serverUrl, publicServerUrl, namespace);
    sharedKey = result.sharedKey;
    deviceId = result.deviceId;
    sessionId = result.sessionId;
    sessionToken = result.sessionToken;
  }

  // 2. 连接 relay
  const relay = new RelayClient(serverUrl, sessionToken);

  // 3. 模式循环
  let currentMode: Mode = "remote";

  const switchMode = () => {
    if (currentMode === "local") {
      currentMode = "remote";
      console.log("\n切换到远程模式（终端只读）");
      void setupRemoteMode(relay, sharedKey, deviceId, sessionId, "broadcast", serverUrl, sessionToken);
    } else {
      currentMode = "local";
      console.log("\n切换到本地模式（终端可交互）");
      startLocalMode().catch(console.error);
    }
  };

  // 默认进入远程模式，等待手机端 prompt
  await setupRemoteMode(relay, sharedKey, deviceId, sessionId, "broadcast", serverUrl, sessionToken);

  if (prewarmEnabled) {
    const agent = (prewarmAgentArg || defaultAgent) as AgentType;
    if (!["claude", "codex", "gemini"].includes(agent)) {
      console.warn(`[prewarm] 未知 agent: ${agent}，已跳过`);
    } else {
      prewarmAgent({ agent, prompt: prewarmPrompt, label: "prewarm" }).catch(() => {});
    }
  }

  // 监听双空格切换
  watchDoubleSpace(switchMode);

  console.log(`Yuanio CLI 已启动 | 当前: 远程模式 | 命名空间: ${namespace} | 双空格切换本地模式`);
}

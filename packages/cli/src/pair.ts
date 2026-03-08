import {
  generateWebKeyPair,
  deriveAesGcmKey,
  DEFAULT_E2EE_INFO,
  PROTOCOL_VERSION,
  normalizeNamespace,
} from "@yuanio/shared";
import { saveKeys } from "./keystore";

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 5 * 60 * 1000;

export async function startPairing(
  serverUrl: string,
  publicServerUrl: string = serverUrl,
  namespace: string = "default",
): Promise<{
  sharedKey: CryptoKey;
  deviceId: string;
  sessionId: string;
  sessionToken: string;
}> {
  const kp = await generateWebKeyPair();

  const ns = normalizeNamespace(namespace);

  // 1. 创建配对请求
  const res = await fetch(`${serverUrl}/api/v1/pair/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-yuanio-namespace": ns,
      "x-yuanio-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({ publicKey: kp.publicKey, namespace: ns, protocolVersion: PROTOCOL_VERSION }),
  });

  if (res.status === 429) {
    throw new Error("配对请求过于频繁，请稍后再试（每分钟最多 5 次）");
  }
  if (!res.ok) {
    throw new Error(`配对请求失败: HTTP ${res.status}`);
  }

  const data = await readJsonResponse(res, "pair/create");
  const { pairingCode, sessionToken, deviceId, sessionId } = data as {
    pairingCode: string;
    sessionToken: string;
    deviceId: string;
    sessionId: string;
  };

  console.log(`\n配对码: ${pairingCode}`);

  // 生成 QR 码供手机扫描
  const qrData = JSON.stringify({ server: publicServerUrl, code: pairingCode, namespace: ns });
  try {
    const qr = await import("qrcode-terminal");
    qr.generate(qrData, { small: true }, (code: string) => console.log(code));
  } catch { /* qrcode-terminal 不可用时静默跳过 */ }

  console.log("等待手机端加入（扫码或输入配对码）...\n");

  // 2. 轮询等待 App join
  const appPublicKey = await pollForJoin(serverUrl, pairingCode);

  // 3. DH 计算共享密钥
  const sharedKey = await deriveAesGcmKey({
    privateKey: kp.privateKey,
    publicKey: appPublicKey,
    salt: sessionId,
    info: DEFAULT_E2EE_INFO,
  });

  // 4. 持久化
  saveKeys({
    cryptoVersion: "webcrypto",
    publicKey: kp.publicKey,
    secretKey: kp.privateKey,
    deviceId,
    sessionId,
    sessionToken,
      peerPublicKey: appPublicKey,
      serverUrl,
      namespace: ns,
      protocolVersion: PROTOCOL_VERSION,
    });

  console.log("配对成功。\n");
  return { sharedKey, deviceId, sessionId, sessionToken };
}

async function pollForJoin(serverUrl: string, code: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT;

  while (Date.now() < deadline) {
    const res = await fetch(`${serverUrl}/api/v1/pair/status/${code}`);
    if (res.ok) {
      try {
        const data = await readJsonResponse(res, "pair/status");
        if (data.joined && data.appPublicKey) {
          return data.appPublicKey as string;
        }
      } catch (e: any) {
        console.warn(`[pair] status JSON 解析失败: ${e?.message || e}`);
      }
    } else {
      const text = await res.text();
      console.warn(`[pair] status 请求失败: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error("配对超时");
}

async function readJsonResponse(res: Response, label: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200);
    throw new Error(`[${label}] JSON 解析失败 (HTTP ${res.status}): ${snippet}`);
  }
}

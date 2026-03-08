import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { networkInterfaces } from "node:os";
import { PROTOCOL_VERSION, normalizeNamespace } from "@yuanio/shared";
import type { LauncherI18n } from "../i18n/index.ts";

type PairStatus = "idle" | "generating" | "waiting" | "success" | "timeout" | "error";

/** 获取本机第一个非回环 IPv4 地址 */
function getLanIp(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && net.internal === false) return net.address;
    }
  }
  return null;
}

/** 将 localhost URL 替换为 LAN IP，供手机扫码使用 */
function toLanUrl(url: string): string {
  const lanIp = getLanIp();
  if (!lanIp) return url;
  return url.replace(/localhost|127\.0\.0\.1/i, lanIp);
}

interface PairTabProps {
  serverUrl: string;
  localRelayUrl?: string;
  namespace?: string;
  i18n: LauncherI18n;
  onPairSuccess?: () => Promise<void> | void;
  onDone: () => void;
  onEnsureRelay?: () => Promise<void> | void;
}

function healthUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/health`;
}

async function probeHealth(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl(baseUrl), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(baseUrl, 3000)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function readinessLabel(i18n: LauncherI18n, value: boolean | null): string {
  if (value === null) return i18n.t("pair.readiness.state.unknown");
  return value ? i18n.t("pair.readiness.state.ok") : i18n.t("pair.readiness.state.fail");
}

export function PairTab({ serverUrl, localRelayUrl, namespace, i18n, onPairSuccess, onDone, onEnsureRelay }: PairTabProps) {
  const [status, setStatus] = useState<PairStatus>("idle");
  const [qrText, setQrText] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [error, setError] = useState("");
  const [lanIp, setLanIp] = useState<string | null>(getLanIp());
  const [controlReady, setControlReady] = useState<boolean | null>(null);
  const [mobileReady, setMobileReady] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [opMessage, setOpMessage] = useState("");

  const controlUrl = localRelayUrl || serverUrl;
  const isLan = !serverUrl.startsWith("https://");
  const displayUrl = isLan ? toLanUrl(serverUrl) : serverUrl;

  const refreshReadiness = useCallback(async () => {
    setChecking(true);
    setLanIp(getLanIp());
    const [controlOk, mobileOk] = await Promise.all([
      probeHealth(controlUrl),
      isLan ? probeHealth(displayUrl) : Promise.resolve<boolean | null>(null),
    ]);
    setControlReady(controlOk);
    setMobileReady(mobileOk);
    setChecking(false);
  }, [controlUrl, displayUrl, isLan]);

  const ensureRelay = useCallback(async () => {
    if (!onEnsureRelay || relayBusy) return;
    setRelayBusy(true);
    setOpMessage(i18n.t("pair.action.start_relay"));
    try {
      await onEnsureRelay();
      const ok = await waitHealth(controlUrl, 15000);
      setOpMessage(ok ? i18n.t("pair.action.relay_started") : i18n.t("pair.action.relay_timeout"));
    } catch (err: any) {
      setOpMessage(i18n.t("pair.action.relay_failed", { error: err?.message || String(err) }));
    } finally {
      setRelayBusy(false);
      await refreshReadiness();
    }
  }, [controlUrl, i18n, onEnsureRelay, refreshReadiness, relayBusy]);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness]);

  const startPair = useCallback(async () => {
    setStatus("generating");
    setError("");

    try {
      let ready = await probeHealth(controlUrl);
      if (!ready && onEnsureRelay) {
        setOpMessage(i18n.t("pair.action.start_relay"));
        await onEnsureRelay();
        ready = await waitHealth(controlUrl, 15000);
      }
      if (!ready) {
        throw new Error(i18n.t("pair.error.relay_not_ready", { url: controlUrl }));
      }

      const { generateWebKeyPair, deriveAesGcmKey, DEFAULT_E2EE_INFO } = await import("@yuanio/shared");
      const { saveKeys } = await import("../../keystore.ts");

      const kp = await generateWebKeyPair();

      const ns = normalizeNamespace(namespace);

      // 创建配对请求
      const res = await fetch(`${controlUrl}/api/v1/pair/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-yuanio-namespace": ns,
          "x-yuanio-protocol-version": PROTOCOL_VERSION,
        },
        body: JSON.stringify({ publicKey: kp.publicKey, namespace: ns, protocolVersion: PROTOCOL_VERSION }),
      });

      if (!res.ok) {
        throw new Error(i18n.t("pair.error.create_failed", { status: res.status }));
      }

      const data = await res.json() as {
        pairingCode: string;
        sessionToken: string;
        deviceId: string;
        sessionId: string;
      };

      setPairingCode(data.pairingCode);

      // 生成 QR 码（局域网模式下将 localhost 替换为 LAN IP）
      const qrServerUrl = displayUrl;
      const qrData = JSON.stringify({ server: qrServerUrl, code: data.pairingCode, namespace: ns });
      try {
        const QRCode = await import("qrcode-terminal");
        const qr = await new Promise<string>((resolve) =>
          QRCode.generate(qrData, { small: true }, resolve)
        );
        setQrText(qr);
      } catch {
        setQrText(i18n.t("pair.qr_generation_failed"));
      }

      setStatus("waiting");

      // 轮询等待
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        const pollRes = await fetch(`${controlUrl}/api/v1/pair/status/${data.pairingCode}`);
        if (pollRes.ok) {
          const pollData = await pollRes.json() as { joined?: boolean; appPublicKey?: string };
          if (pollData.joined && pollData.appPublicKey) {
            // DH 密钥交换
            const sharedKey = await deriveAesGcmKey({
              privateKey: kp.privateKey,
              publicKey: pollData.appPublicKey,
              salt: data.sessionId,
              info: DEFAULT_E2EE_INFO,
            });

            saveKeys({
              cryptoVersion: "webcrypto",
              publicKey: kp.publicKey,
              secretKey: kp.privateKey,
              deviceId: data.deviceId,
              sessionId: data.sessionId,
              sessionToken: data.sessionToken,
              peerPublicKey: pollData.appPublicKey,
              serverUrl: controlUrl,
              namespace: ns,
              protocolVersion: PROTOCOL_VERSION,
            });

            setStatus("success");
            if (onPairSuccess) {
              try {
                await onPairSuccess();
              } catch (pairSuccessErr: any) {
                console.warn("[pair] onPairSuccess failed:", pairSuccessErr?.message || pairSuccessErr);
              }
            }
            setTimeout(onDone, 1200);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      setStatus("timeout");
    } catch (err: any) {
      setError(err.message || String(err));
      setStatus("error");
    } finally {
      await refreshReadiness();
    }
  }, [controlUrl, displayUrl, i18n, namespace, onDone, onEnsureRelay, onPairSuccess, refreshReadiness]);

  useInput((input) => {
    if (input === "v") {
      void refreshReadiness();
      return;
    }
    if (input === "r") {
      void ensureRelay();
      return;
    }
    if (input === "p" && (status === "idle" || status === "timeout" || status === "error")) {
      void startPair();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>{i18n.t("pair.title")}</Text>
      {isLan ? (
        <Text color="yellow">⚠ {i18n.t("pair.mode.lan", { url: displayUrl })}</Text>
      ) : (
        <Text color="green">✔ {i18n.t("pair.mode.public", { url: serverUrl })}</Text>
      )}
      <Text dimColor>{i18n.t("pair.namespace", { namespace: normalizeNamespace(namespace) })}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>{i18n.t("pair.readiness.title")}</Text>
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text wrap="truncate">
            <Text dimColor>{`${i18n.t("pair.readiness.control_url")} `}</Text>
            {controlUrl}
          </Text>
          <Text wrap="truncate">
            <Text dimColor>{`${i18n.t("pair.readiness.mobile_url")} `}</Text>
            {displayUrl}
          </Text>
          <Text>
            <Text dimColor>{`${i18n.t("pair.readiness.lan_ip")} `}</Text>
            {lanIp || i18n.t("common.none")}
          </Text>
          <Text>
            <Text dimColor>{`${i18n.t("pair.readiness.control_health")} `}</Text>
            <Text color={controlReady === false ? "red" : controlReady ? "green" : "yellow"}>{readinessLabel(i18n, controlReady)}</Text>
          </Text>
          {isLan ? (
            <Text>
              <Text dimColor>{`${i18n.t("pair.readiness.mobile_health")} `}</Text>
              <Text color={mobileReady === false ? "red" : mobileReady ? "green" : "yellow"}>{readinessLabel(i18n, mobileReady)}</Text>
            </Text>
          ) : null}
          <Text dimColor>{i18n.t("pair.prompt.actions")}</Text>
          {checking ? <Text dimColor>{i18n.t("pair.readiness.checking")}</Text> : null}
          {relayBusy ? <Text dimColor>{i18n.t("pair.action.start_relay")}</Text> : null}
          {opMessage ? <Text dimColor wrap="truncate">{opMessage}</Text> : null}
        </Box>
      </Box>
      {renderContent(status, qrText, pairingCode, error, i18n)}
    </Box>
  );
}

function renderContent(
  status: PairStatus,
  qrText: string,
  pairingCode: string,
  error: string,
  i18n: LauncherI18n,
) {
  switch (status) {
    case "idle":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>{i18n.t("pair.prompt.start")}</Text>
        </Box>
      );

    case "generating":
      return <Text color="yellow">{i18n.t("pair.status.generating")}</Text>;

    case "waiting":
      return (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text>{i18n.t("pair.code", { code: pairingCode })}</Text>
          <Box borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text>{qrText}</Text>
          </Box>
          <Text dimColor>{i18n.t("pair.waiting_scan")}</Text>
        </Box>
      );

    case "success":
      return <Text color="green">✔ {i18n.t("pair.status.success")}</Text>;

    case "timeout":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">{i18n.t("pair.status.timeout")}</Text>
          <Text>{i18n.t("pair.prompt.retry")}</Text>
        </Box>
      );

    case "error":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">{i18n.t("pair.error", { error })}</Text>
          <Text>{i18n.t("pair.prompt.retry")}</Text>
        </Box>
      );
  }
}

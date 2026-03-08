import type { ServiceAccount } from "firebase-admin";
import admin from "firebase-admin";
import { loadRelayRuntimeEnv } from "@yuanio/shared";

let initialized = false;

export type PushEventType = "approval_requested" | "task_completed" | "run_failed";

export interface PushPayload {
  title: string;
  body: string;
  priority: "high" | "normal";
  eventType: PushEventType;
  messageType: string;
  sessionId?: string;
  messageId?: string;
}

/** 浠庣幆澧冨彉閲忓垵濮嬪寲 Firebase Admin SDK */
export function initFCM() {
  const { env: relayEnv } = loadRelayRuntimeEnv({ env: process.env, startDir: import.meta.dir });
  const raw = relayEnv.FCM_SERVICE_ACCOUNT;
  if (!raw) {
    console.log("[fcm] FCM_SERVICE_ACCOUNT ??????????");
    return;
  }
  try {
    const sa: ServiceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    initialized = true;
    console.log("[fcm] Firebase Admin SDK ?????");
  } catch (e) {
    console.error("[fcm] ?????", e);
  }
}

export function isFCMEnabled(): boolean {
  return initialized;
}

/** 鏍规嵁娑堟伅绫诲瀷鏋勫缓鎺ㄩ€佸唴瀹?*/
export function buildPushPayload(
  type: string,
  context?: { sessionId?: string; messageId?: string },
): PushPayload | null {
  switch (type) {
    case "stream_end":
      return {
        title: "Yuanio",
        body: "浠诲姟瀹屾垚",
        priority: "normal",
        eventType: "task_completed",
        messageType: type,
        sessionId: context?.sessionId,
        messageId: context?.messageId,
      };
    case "approval_req":
      return {
        title: "Yuanio 路 瀹℃壒",
        body: "闇€瑕佸鎵?- 鐐瑰嚮鏌ョ湅",
        priority: "high",
        eventType: "approval_requested",
        messageType: type,
        sessionId: context?.sessionId,
        messageId: context?.messageId,
      };
    case "status":
      // status 娑堟伅闇€瑕佽皟鐢ㄦ柟妫€鏌ユ槸鍚﹀惈 error
      return null;
    default:
      return null;
  }
}

/** 鏋勫缓 error 鐘舵€佺殑鎺ㄩ€?payload */
export function buildErrorPushPayload(context?: { sessionId?: string; messageId?: string }): PushPayload {
  return {
    title: "Yuanio",
    body: "Agent 鍑洪敊",
    priority: "high",
    eventType: "run_failed",
    messageType: "status",
    sessionId: context?.sessionId,
    messageId: context?.messageId,
  };
}

function resolveAndroidChannel(eventType: PushEventType): string {
  switch (eventType) {
    case "approval_requested":
      return "approval";
    case "run_failed":
      return "errors";
    case "task_completed":
    default:
      return "agent_status";
  }
}

function toFcmData(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = {
    eventType: payload.eventType,
    messageType: payload.messageType,
  };
  if (payload.sessionId) data.sessionId = payload.sessionId;
  if (payload.messageId) data.messageId = payload.messageId;
  return data;
}

/** 鍙戦€?FCM 鎺ㄩ€侊紝澶勭悊 token 澶辨晥 */
export async function sendPush(
  fcmToken: string,
  payload: PushPayload,
): Promise<boolean> {
  if (!initialized) return false;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: payload.title, body: payload.body },
      data: toFcmData(payload),
      android: {
        priority: payload.priority,
        notification: {
          channelId: resolveAndroidChannel(payload.eventType),
          clickAction: "OPEN_CHAT",
        },
      },
    });
    return true;
  } catch (e: any) {
    // token 澶辨晥锛坲nregistered / invalid锛?
if (e.code === "messaging/registration-token-not-registered" ||
        e.code === "messaging/invalid-registration-token") {
      console.log("[fcm] token 澶辨晥锛岄渶娓呯悊:", fcmToken.slice(0, 20));
      return false;
    }
    console.error("[fcm] ?????", e);
    return false;
  }
}




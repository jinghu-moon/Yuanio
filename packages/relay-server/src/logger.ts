import pino from "pino";
import { loadRelayRuntimeEnv } from "@yuanio/shared";

const { env: relayEnv } = loadRelayRuntimeEnv({ env: process.env, startDir: import.meta.dir });

export const logger = pino({
  level: relayEnv.LOG_LEVEL || "info",
  redact: {
    paths: ["token", "password", "deviceId", "sessionId", "fcmToken"],
    remove: true,
  },
});

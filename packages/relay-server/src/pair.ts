import { randomInt } from "node:crypto";

// 生成 XXX-XXX 格式配对码
export function generatePairingCode(): string {
  const part = () => String(randomInt(0, 1000)).padStart(3, "0");
  return `${part()}-${part()}`;
}

export function generateToken(): string {
  return crypto.randomUUID();
}

export function generateDeviceId(): string {
  return crypto.randomUUID();
}

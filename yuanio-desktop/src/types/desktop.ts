export type ServiceStatus = "stopped" | "starting" | "running" | "error";
export type ServiceInfo = {
  status: ServiceStatus;
  pid?: number;
  port?: number;
  url?: string;
  publicUrl?: string;
};
export type ServiceState = {
  relay: ServiceInfo;
  daemon: ServiceInfo;
  tunnel: ServiceInfo;
};
export type CloudflaredStatus = "unknown" | "checking" | "ready" | "missing" | "error";
export type CloudflaredServiceState = {
  supported: boolean;
  status: CloudflaredStatus;
  installed: boolean;
  running: boolean;
  checking: boolean;
  installing: boolean;
  binPath?: string;
  lastBackupDir?: string;
  detail?: string;
};
export type ServiceProfile = "lan" | "tunnel" | "idle";
export type ServiceSnapshot = {
  service: ServiceState;
  cloudflared: CloudflaredServiceState;
  profile: ServiceProfile;
};
export type PairStatus = "idle" | "generating" | "waiting" | "success" | "timeout" | "error";
export type PairingPrepareResponse = {
  pairing_code: string;
  server_url: string;
  namespace: string;
};
export type PairingPollResponse = {
  status: "waiting" | "success" | "timeout" | "error" | "idle";
  message?: string | null;
};
export type MonitorSession = {
  sessionId: string;
  role?: string;
  onlineCount?: number;
  hasAgentOnline?: boolean;
  hasAppOnline?: boolean;
};
export type MonitorLine = {
  id: string;
  ts: number;
  type: string;
  text: string;
  sessionId: string;
};
export type MonitorSessionsResponse = {
  currentSessionId?: string | null;
  sessions?: MonitorSession[];
};
export type MonitorMessagesResponse = {
  lines?: MonitorLine[];
  nextCursor?: number | null;
};
export type MonitorRealtimeStatus = {
  status: "waiting" | "connected" | "disconnected" | "error";
  message?: string;
};
export type AppLogEntry = {
  ts: number;
  source: string;
  level: string;
  text: string;
};
export type SkillItem = {
  id: string;
  name: string;
  description: string;
  scope: string;
  source: string;
  path: string;
};
export type SkillCandidate = {
  id: string;
  name: string;
  description: string;
  path: string;
  valid: boolean;
  warnings: string[];
};
export type SkillLogItem = {
  id: string;
  at: number;
  level: string;
  action: string;
  message: string;
};
export type SkillInstallPrepareResponse = {
  installId: string;
  candidates: SkillCandidate[];
};
export type SkillInstallStatusResponse = {
  candidates: SkillCandidate[];
};
export type SkillInstallCommitResponse = {
  total: number;
  installed: unknown[];
  skipped: unknown[];
  failed: unknown[];
};
export type SkillInstallCancelResponse = {
  cancelled: boolean;
  existed: boolean;
};
export type DoctorCheck = {
  label: string;
  ok: boolean;
  detail: string;
};
export type DoctorReport = {
  checks: DoctorCheck[];
  failed: number;
};
export type AppConfig = {
  serverUrl: string;
  namespace: string;
  relayPort: number;
  autoStart: boolean;
  connectionProfile: "lan" | "tunnel";
  tunnelMode: "quick" | "named";
  tunnelName: string;
  tunnelHostname: string;
  language: "zh-CN" | "zh-TW" | "en";
};
export type Locale = AppConfig["language"];
export type SystemInfo = {
  os: string;
  arch: string;
  pid: number;
};
export type DaemonStatus = {
  running: boolean;
  pid?: number | null;
  port?: number | null;
  version?: string | null;
  started_at?: string | null;
  sessions?: string[] | null;
};
export type QuickLink = {
  id: string;
  label: string;
};
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

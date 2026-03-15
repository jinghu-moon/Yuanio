<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QRCode from "qrcode";
import {
  IconActivityHeartbeat,
  IconCloud,
  IconLayoutDashboard,
  IconListDetails,
  IconServer,
  IconSettings,
  IconShieldCheck,
  IconTool,
  IconUsers,
} from "@tabler/icons-vue";
import TopBar from "./sections/TopBar.vue";
import SidebarNav from "./sections/SidebarNav.vue";
import DashboardSection from "./sections/DashboardSection.vue";
import ServicesSection from "./sections/ServicesSection.vue";
import CloudflaredSection from "./sections/CloudflaredSection.vue";
import PairingSection from "./sections/PairingSection.vue";
import MonitorSection from "./sections/MonitorSection.vue";
import ConfigSection from "./sections/ConfigSection.vue";
import SkillsSection from "./sections/SkillsSection.vue";
import DoctorSection from "./sections/DoctorSection.vue";
import LogsSection from "./sections/LogsSection.vue";
import type {
  AppConfig,
  AppLogEntry,
  CloudflaredServiceState,
  DaemonStatus,
  DoctorReport,
  Locale,
  MonitorLine,
  MonitorMessagesResponse,
  MonitorRealtimeStatus,
  MonitorSession,
  MonitorSessionsResponse,
  PairingPollResponse,
  PairingPrepareResponse,
  PairStatus,
  QuickLink,
  ServiceProfile,
  ServiceSnapshot,
  ServiceState,
  ServiceStatus,
  SkillCandidate,
  SkillInstallCancelResponse,
  SkillInstallCommitResponse,
  SkillInstallPrepareResponse,
  SkillInstallStatusResponse,
  SkillItem,
  SkillLogItem,
  SystemInfo,
} from "./types/desktop";

const theme = ref<"dark" | "light">("dark");
const pairingCode = ref("");
const appLogs = ref<AppLogEntry[]>([]);
const uiLogs = ref<AppLogEntry[]>([]);
const logFilter = ref("all");
const logSearch = ref("");
const serverUrl = ref("http://localhost:3000");
const relayPort = ref(3000);
const tunnelMode = ref<"quick" | "named">("quick");
const tunnelName = ref("");
const tunnelHostname = ref("");
const pairingMode = ref<"start" | "join">("start");
const pairingNamespace = ref("default");
const serviceState = ref<ServiceState>({
  relay: { status: "stopped", port: relayPort.value, url: `http://localhost:${relayPort.value}` },
  daemon: { status: "stopped" },
  tunnel: { status: "stopped" },
});
const cloudflaredState = ref<CloudflaredServiceState | null>(null);
const activeProfile = ref<ServiceProfile>("idle");
const pairStatus = ref<PairStatus>("idle");
const pairError = ref("");
const pairOpMessage = ref("");
const pairQrData = ref<string | null>(null);
const pairChecking = ref(false);
const pairControlReady = ref<boolean | null>(null);
const pairMobileReady = ref<boolean | null>(null);
const pairLanIp = ref<string | null>(null);
let pairPollTimer: ReturnType<typeof setTimeout> | null = null;
const configAutoStart = ref(false);
const configProfile = ref<"lan" | "tunnel">("tunnel");
const configLanguage = ref<"zh-CN" | "zh-TW" | "en">("zh-CN");
const configSnapshot = ref<AppConfig | null>(null);
const configMessage = ref("");
const configLoading = ref(false);
const configSaving = ref(false);
let autoStartTriggered = false;
const skillSource = ref("./refer/teleclaude");
const skillScope = ref<"project" | "user">("project");
const skillInstallId = ref("");
const skillCandidates = ref<SkillCandidate[]>([]);
const skillSelected = ref<string[]>([]);
const skillInstalled = ref<SkillItem[]>([]);
const skillLogs = ref<SkillLogItem[]>([]);
const skillStatus = ref("就绪");
const skillError = ref("");
const skillBusy = ref(false);
const doctorControlUrl = ref("");
const doctorPublicUrl = ref("");
const doctorRunning = ref(false);
const doctorReport = ref<DoctorReport | null>(null);
const doctorError = ref("");
const monitorReady = ref(false);
const monitorStatus = ref("等待连接");
const monitorError = ref<string | null>(null);
const monitorSessions = ref<MonitorSession[]>([]);
const monitorCurrentSessionId = ref<string | null>(null);
const monitorSelectedSessionId = ref<string | null>(null);
const monitorLines = ref<MonitorLine[]>([]);
const monitorLogs = new Map<string, MonitorLine[]>();
const monitorSeenIds = new Map<string, Set<string>>();
const monitorAfterCursor = new Map<string, number>();
const monitorPolling = { sessions: false, messages: false };
const monitorRealtime = ref<MonitorRealtimeStatus>({ status: "waiting" });
let monitorSessionsTimer: ReturnType<typeof setInterval> | null = null;
let monitorMessagesTimer: ReturnType<typeof setInterval> | null = null;
let appLogsTimer: ReturnType<typeof setInterval> | null = null;
let monitorLineUnlisten: (() => void) | null = null;
let monitorRealtimeUnlisten: (() => void) | null = null;
const systemInfo = ref<SystemInfo | null>(null);
const daemonStatus = ref<DaemonStatus | null>(null);
const appVersion = ref<string | null>(null);
const uptimeSeconds = ref(0);
let uptimeTimer: ReturnType<typeof setInterval> | null = null;
const cloudflaredConfirm = ref(false);
const quickLinks: QuickLink[] = [
  { id: "services", label: "服务控制" },
  { id: "pairing", label: "配对入口" },
  { id: "monitor", label: "远程监控" },
  { id: "logs", label: "日志面板" },
  { id: "skills", label: "技能管理" },
  { id: "config", label: "配置中心" },
];
type SidebarItem = {
  id: string;
  label: string;
  icon: Component;
};
const sidebarItems: SidebarItem[] = [
  { id: "dashboard", label: "仪表盘", icon: IconLayoutDashboard },
  { id: "services", label: "服务控制", icon: IconServer },
  { id: "cloudflared", label: "Cloudflared 服务", icon: IconCloud },
  { id: "pairing", label: "配对入口", icon: IconUsers },
  { id: "monitor", label: "远程监控", icon: IconActivityHeartbeat },
  { id: "config", label: "配置中心", icon: IconSettings },
  { id: "skills", label: "技能管理", icon: IconTool },
  { id: "doctor", label: "诊断", icon: IconShieldCheck },
  { id: "logs", label: "日志面板", icon: IconListDetails },
];
const sectionOrder = sidebarItems.map((item) => item.id);
const activeSection = ref<SidebarItem["id"]>("dashboard");
const contentRef = ref<HTMLDivElement | null>(null);
const sidebarCollapsed = ref(false);
const sidebarWidth = ref(240);
const sidebarMinWidth = 200;
const sidebarMaxWidth = 320;
const sidebarStorageKey = "yuanio.desktop.sidebar.width";
const uiStorageKey = "yuanio.desktop.ui";
const configDraftStorageKey = "yuanio.desktop.config.draft";
const uiBootstrapped = ref(false);
const configBootstrapped = ref(false);
const sidebarResizing = ref(false);
let sidebarResizeCleanup: (() => void) | null = null;
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};
const clampSidebarWidth = (value: number) =>
  Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, Math.round(value)));
const loadSidebarWidth = () => {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(sidebarStorageKey);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) {
    sidebarWidth.value = clampSidebarWidth(parsed);
  }
};
const saveSidebarWidth = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(sidebarStorageKey, String(sidebarWidth.value));
};
const loadUiPrefs = () => {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(uiStorageKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<{
      theme: "dark" | "light";
      sidebarCollapsed: boolean;
      activeSection: SidebarItem["id"];
      logFilter: string;
      logSearch: string;
      pairingMode: "start" | "join";
      skillScope: "project" | "user";
      skillSource: string;
    }>;
    if (parsed.theme === "dark" || parsed.theme === "light") {
      theme.value = parsed.theme;
    }
    if (typeof parsed.sidebarCollapsed === "boolean") {
      sidebarCollapsed.value = parsed.sidebarCollapsed;
    }
    if (parsed.activeSection && sidebarItems.some((item) => item.id === parsed.activeSection)) {
      activeSection.value = parsed.activeSection;
    }
    if (typeof parsed.logFilter === "string") {
      logFilter.value = parsed.logFilter;
    }
    if (typeof parsed.logSearch === "string") {
      logSearch.value = parsed.logSearch;
    }
    if (parsed.pairingMode === "start" || parsed.pairingMode === "join") {
      pairingMode.value = parsed.pairingMode;
    }
    if (parsed.skillScope === "project" || parsed.skillScope === "user") {
      skillScope.value = parsed.skillScope;
    }
    if (typeof parsed.skillSource === "string") {
      skillSource.value = parsed.skillSource;
    }
  } catch {
    return;
  }
};
const saveUiPrefs = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(uiStorageKey, JSON.stringify({
    theme: theme.value,
    sidebarCollapsed: sidebarCollapsed.value,
    activeSection: activeSection.value,
    logFilter: logFilter.value,
    logSearch: logSearch.value,
    pairingMode: pairingMode.value,
    skillScope: skillScope.value,
    skillSource: skillSource.value,
  }));
};
const startResizeSidebar = (event: PointerEvent) => {
  if (sidebarCollapsed.value) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = sidebarWidth.value;
  sidebarResizing.value = true;
  const originalUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";

  const onMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX;
    sidebarWidth.value = clampSidebarWidth(startWidth + delta);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    sidebarResizing.value = false;
    document.body.style.userSelect = originalUserSelect;
    saveSidebarWidth();
    sidebarResizeCleanup = null;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  sidebarResizeCleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.userSelect = originalUserSelect;
  };
};

const translations: Record<Exclude<Locale, "zh-CN">, Record<string, string>> = {
  "zh-TW": {
    "运行中": "執行中",
    "启动中": "啟動中",
    "已停止": "已停止",
    "异常": "異常",
    "未连接": "未連線",
    "未知": "未知",
    "不支持": "不支援",
    "未安装": "未安裝",
    "检测中": "檢測中",
    "已安装": "已安裝",
    "浅色": "淺色",
    "深色": "深色",
    "准备中": "準備中",
    "等待扫码": "等待掃碼",
    "已完成": "已完成",
    "已超时": "已超時",
    "失败": "失敗",
    "待命": "待命",
    "可用": "可用",
    "不可用": "不可用",
    "等待连接": "等待連線",
    "尚未配对": "尚未配對",
    "监控不可用": "監控不可用",
    "已连接 · {count} 会话": "已連線 · {count} 個會話",
    "控制端不可用，请检查地址或网络": "控制端不可用，請檢查位址或網路",
    "控制端未就绪，尝试启动本地 Relay...": "控制端未就緒，嘗試啟動本機 Relay...",
    "控制端启动超时": "控制端啟動超時",
    "控制端健康": "控制端健康",
    "移动端健康": "行動端健康",
    "检测中...": "檢測中...",
    "刷新检测": "刷新檢測",
    "暂无二维码": "暫無 QR 碼",
    "暂无会话。": "暫無會話。",
    "暂无消息。": "暫無訊息。",
    "暂无日志。": "暫無日誌。",
    "暂无已安装 skills。": "暫無已安裝 skills。",
    "暂无候选项。": "暫無候選項。",
    "暂无日志": "暫無日誌",
    "清空当前会话": "清空目前會話",
    "监控": "監控",
    "已连接": "已連線",
    "实时订阅已连接": "即時訂閱已連線",
    "实时订阅已断开": "即時訂閱已斷開",
    "实时订阅失败：{message}": "即時訂閱失敗：{message}",
    "服务概览": "服務概覽",
    "服务控制": "服務控制",
    "仪表盘": "儀表板",
    "服务状态": "服務狀態",
    "当前配置": "目前設定",
    "系统信息": "系統資訊",
    "最近日志": "最近日誌",
    "日志面板": "日誌面板",
    "筛选": "篩選",
    "搜索日志": "搜尋日誌",
    "全部": "全部",
    "刷新": "刷新",
    "清空日志": "清空日誌",
    "启动 LAN": "啟動 LAN",
    "启动 Tunnel": "啟動 Tunnel",
    "全部停止": "全部停止",
    "重载桥接": "重載橋接",
    "启动": "啟動",
    "停止": "停止",
    "重启": "重啟",
    "安装 / 修复": "安裝 / 修復",
    "确认安装 Cloudflared 服务": "確認安裝 Cloudflared 服務",
    "再次点击确认安装 Cloudflared 服务。": "再次點擊確認安裝 Cloudflared 服務。",
    "刷新状态": "刷新狀態",
    "Tunnel 模式": "Tunnel 模式",
    "Quick": "Quick",
    "Named": "Named",
    "配对入口": "配對入口",
    "创建配对": "建立配對",
    "加入配对": "加入配對",
    "生成配对码": "產生配對碼",
    "提交配对": "提交配對",
    "扫码": "掃碼",
    "取消": "取消",
    "连接检测": "連線檢測",
    "扫码配对": "掃碼配對",
    "错误：{message}": "錯誤：{message}",
    "状态：{status}": "狀態：{status}",
    "个": "個",
    "条": "條",
    "日志": "日誌",
    "通过": "通過",
    "切换为{theme}": "切換為{theme}",
    "Cloudflared 服务": "Cloudflared 服務",
    "installId（可选）": "installId（可選）",
    "候选项": "候選項",
    "全选有效": "全選有效",
    "取消配对失败：{message}": "取消配對失敗：{message}",
    "处理中...": "處理中...",
    "安装源（如 ./refer/teleclaude）": "安裝來源（如 ./refer/teleclaude）",
    "已取消配对。": "已取消配對。",
    "控制端不可用": "控制端不可用",
    "提交(覆盖)": "提交(覆蓋)",
    "提交(跳过)": "提交(跳過)",
    "配置中心": "設定中心",
    "未保存": "未儲存",
    "已同步": "已同步",
    "重新加载": "重新載入",
    "保存配置": "儲存設定",
    "加载中...": "載入中...",
    "保存中...": "儲存中...",
    "技能管理": "技能管理",
    "就绪": "就緒",
    "诊断": "診斷",
    "开始诊断": "開始診斷",
    "诊断中...": "診斷中...",
    "输入配对码（如 123-456）": "輸入配對碼（如 123-456）",
    "命名空间（默认 default）": "命名空間（預設 default）",
    "控制端地址（如 http://localhost:3000）": "控制端位址（如 http://localhost:3000）",
    "公网地址（可选）": "公開地址（可選）",
    "Relay 端口": "Relay 連接埠",
    "Tunnel 名称（如 yuanio-main）": "Tunnel 名稱（如 yuanio-main）",
    "Tunnel Hostname（如 xxx.trycloudflare.com）": "Tunnel Hostname（如 xxx.trycloudflare.com）",
    "Server URL": "Server URL",
    "命名空间": "命名空間",
    "自动启动": "自動啟動",
    "连接模式": "連線模式",
    "Tunnel 名称": "Tunnel 名稱",
    "Tunnel Host": "Tunnel Host",
    "语言": "語言",
    "简体中文": "簡體中文",
    "繁体中文": "繁體中文",
    "命名": "命名",
    "远程监控": "遠端監控",
    "展示当前会话的消息流与在线状态。": "展示目前會話的訊息流與線上狀態。",
    "等待连接...": "等待連線...",
    "配置中心说明": "統一管理預設連線與語言設定，儲存後影響後續啟動行為。",
    "技能管理说明": "透過 Daemon 管理 skills 安裝、候選與日誌。",
    "诊断说明": "快速檢查控制端、協議、密鑰與環境依賴。",
    "服务概览说明": "保留 CLI 邏輯，桌面端負責狀態展示與快捷控制。",
    "命名 Tunnel 依赖 Cloudflared 服务（Windows 可管理）。": "命名 Tunnel 依賴 Cloudflared 服務（Windows 可管理）。",
    "控制端": "控制端",
    "移动端": "行動端",
    "LAN IP": "LAN IP",
    "输出": "輸出",
    "共 {count} 条": "共 {count} 條",
    "会话": "會話",
    "会话列表": "會話列表",
    "快捷导航": "快捷導航",
    "日志来源": "日誌來源",
    "当前：{profile}": "目前：{profile}",
    "端口": "埠",
    "运行时间": "運行時間",
    "平台": "平台",
    "版本": "版本",
    "系统信息获取失败：{message}": "取得系統資訊失敗：{message}",
    "版本读取失败：{message}": "讀取版本失敗：{message}",
    "日志刷新失败：{message}": "刷新日誌失敗：{message}",
    "清空日志失败：{message}": "清空日誌失敗：{message}",
    "操作失败：{message}": "操作失敗：{message}",
    "已请求启动 Relay。": "已要求啟動 Relay。",
    "已请求停止 Relay。": "已要求停止 Relay。",
    "已请求启动 Tunnel。": "已要求啟動 Tunnel。",
    "已请求停止 Tunnel。": "已要求停止 Tunnel。",
    "已请求启动 Daemon。": "已要求啟動 Daemon。",
    "已请求停止 Daemon。": "已要求停止 Daemon。",
    "已请求停止所有服务。": "已要求停止全部服務。",
    "已请求重载远程桥接。": "已要求重載遠端橋接。",
    "已请求启动 {profile}。": "已要求啟動 {profile}。",
    "启动失败：{message}": "啟動失敗：{message}",
    "停止失败：{message}": "停止失敗：{message}",
    "桥接重载失败：{message}": "橋接重載失敗：{message}",
    "Cloudflared 刷新失败：{message}": "Cloudflared 刷新失敗：{message}",
    "Tunnel 名称为空，无法安装 Cloudflared 服务。": "Tunnel 名稱為空，無法安裝 Cloudflared 服務。",
    "已请求安装 Cloudflared 服务。": "已要求安裝 Cloudflared 服務。",
    "Cloudflared 安装失败：{message}": "Cloudflared 安裝失敗：{message}",
    "状态刷新失败：{message}": "狀態刷新失敗：{message}",
    "已配对（session {id}）。": "已配對（session {id}）。",
    "尚未配对。": "尚未配對。",
    "提交配对码 {code}，等待远端响应。": "提交配對碼 {code}，等待遠端回應。",
    "开始创建配对码...": "開始建立配對碼...",
    "等待扫码结果（桌面端只做入口展示）。": "等待掃碼結果（桌面端僅作入口展示）。",
    "桌面壳初始化完成。": "桌面殼初始化完成。",
    "创建配对后可用移动端加入。": "建立配對後可由行動端加入。",
    "输入移动端显示的配对码完成绑定。": "輸入行動端顯示的配對碼完成綁定。",
    "配置已加载": "設定已載入",
    "配置加载失败：{message}": "設定載入失敗：{message}",
    "配置已保存": "設定已儲存",
    "配置保存失败：{message}": "設定儲存失敗：{message}",
    "已刷新": "已刷新",
    "技能操作失败：{message}": "技能操作失敗：{message}",
    "安装源为空": "安裝來源為空",
    "prepare 完成：{id}": "prepare 完成：{id}",
    "installId 为空": "installId 為空",
    "未选择候选项": "未選擇候選項",
    "提交完成：total={count}": "提交完成：total={count}",
    "已取消安装会话": "已取消安裝會話",
    "安装会话不存在": "安裝會話不存在",
    "控制端地址为空": "控制端位址為空",
    "配对失败": "配對失敗",
    "配对码为空": "配對碼為空",
    "检测控制端健康...": "檢測控制端健康...",
    "启动 Relay 失败": "啟動 Relay 失敗",
    "当前仅支持查看本机会话的实时日志。": "目前僅支援查看本機會話的即時日誌。",
    "路径：{path}": "路徑：{path}",
    "备份：{path}": "備份：{path}",
  },
  "en": {
    "运行中": "Running",
    "启动中": "Starting",
    "已停止": "Stopped",
    "异常": "Error",
    "未连接": "Disconnected",
    "未知": "Unknown",
    "不支持": "Unsupported",
    "未安装": "Not installed",
    "检测中": "Checking",
    "已安装": "Installed",
    "浅色": "Light",
    "深色": "Dark",
    "准备中": "Preparing",
    "等待扫码": "Waiting for scan",
    "已完成": "Completed",
    "已超时": "Timed out",
    "失败": "Failed",
    "待命": "Idle",
    "可用": "Available",
    "不可用": "Unavailable",
    "等待连接": "Waiting for connection",
    "尚未配对": "Not paired",
    "监控不可用": "Monitor unavailable",
    "已连接 · {count} 会话": "Connected · {count} sessions",
    "控制端不可用，请检查地址或网络": "Control server unavailable. Check the URL or network.",
    "控制端未就绪，尝试启动本地 Relay...": "Control server not ready, starting local Relay...",
    "控制端启动超时": "Control server startup timeout",
    "控制端健康": "Control health",
    "移动端健康": "Mobile health",
    "检测中...": "Checking...",
    "刷新检测": "Refresh",
    "暂无二维码": "No QR code",
    "暂无会话。": "No sessions.",
    "暂无消息。": "No messages.",
    "暂无日志。": "No logs.",
    "暂无已安装 skills。": "No installed skills.",
    "暂无候选项。": "No candidates.",
    "暂无日志": "No logs",
    "清空当前会话": "Clear session",
    "监控": "Monitor",
    "已连接": "Connected",
    "实时订阅已连接": "Realtime connected",
    "实时订阅已断开": "Realtime disconnected",
    "实时订阅失败：{message}": "Realtime failed: {message}",
    "服务概览": "Service Overview",
    "服务控制": "Service Control",
    "仪表盘": "Dashboard",
    "服务状态": "Service Status",
    "当前配置": "Current Config",
    "系统信息": "System Info",
    "最近日志": "Recent Logs",
    "日志面板": "Logs",
    "筛选": "Filter",
    "搜索日志": "Search logs",
    "全部": "All",
    "刷新": "Refresh",
    "清空日志": "Clear logs",
    "启动 LAN": "Start LAN",
    "启动 Tunnel": "Start Tunnel",
    "全部停止": "Stop all",
    "重载桥接": "Reload bridge",
    "启动": "Start",
    "停止": "Stop",
    "重启": "Restart",
    "安装 / 修复": "Install / Repair",
    "确认安装 Cloudflared 服务": "Confirm Cloudflared install",
    "再次点击确认安装 Cloudflared 服务。": "Click again to confirm Cloudflared install.",
    "刷新状态": "Refresh status",
    "Tunnel 模式": "Tunnel mode",
    "Quick": "Quick",
    "Named": "Named",
    "配对入口": "Pairing",
    "创建配对": "Create",
    "加入配对": "Join",
    "生成配对码": "Generate code",
    "提交配对": "Submit",
    "扫码": "Scan",
    "取消": "Cancel",
    "连接检测": "Connectivity",
    "扫码配对": "QR pairing",
    "错误：{message}": "Error: {message}",
    "状态：{status}": "Status: {status}",
    "个": "items",
    "条": "items",
    "日志": "Logs",
    "通过": "Passed",
    "切换为{theme}": "Switch to {theme}",
    "Cloudflared 服务": "Cloudflared Service",
    "installId（可选）": "installId (optional)",
    "候选项": "Candidates",
    "全选有效": "Select valid",
    "取消配对失败：{message}": "Cancel pairing failed: {message}",
    "处理中...": "Processing...",
    "安装源（如 ./refer/teleclaude）": "Install source (e.g. ./refer/teleclaude)",
    "已取消配对。": "Pairing cancelled.",
    "控制端不可用": "Control server unavailable",
    "提交(覆盖)": "Commit (overwrite)",
    "提交(跳过)": "Commit (skip)",
    "配置中心": "Config",
    "未保存": "Unsaved",
    "已同步": "Synced",
    "重新加载": "Reload",
    "保存配置": "Save",
    "加载中...": "Loading...",
    "保存中...": "Saving...",
    "技能管理": "Skills",
    "就绪": "Ready",
    "诊断": "Doctor",
    "开始诊断": "Run",
    "诊断中...": "Running...",
    "输入配对码（如 123-456）": "Enter pairing code (e.g. 123-456)",
    "命名空间（默认 default）": "Namespace (default)",
    "控制端地址（如 http://localhost:3000）": "Control URL (e.g. http://localhost:3000)",
    "公网地址（可选）": "Public URL (optional)",
    "Relay 端口": "Relay port",
    "Tunnel 名称（如 yuanio-main）": "Tunnel name (e.g. yuanio-main)",
    "Tunnel Hostname（如 xxx.trycloudflare.com）": "Tunnel hostname (e.g. xxx.trycloudflare.com)",
    "Server URL": "Server URL",
    "命名空间": "Namespace",
    "自动启动": "Auto-start",
    "连接模式": "Profile",
    "Tunnel 名称": "Tunnel name",
    "Tunnel Host": "Tunnel host",
    "语言": "Language",
    "简体中文": "Simplified Chinese",
    "繁体中文": "Traditional Chinese",
    "命名": "Named",
    "远程监控": "Remote Monitor",
    "展示当前会话的消息流与在线状态。": "Show session streams and presence.",
    "等待连接...": "Waiting for connection...",
    "配置中心说明": "Manage default connection and language. Saves affect future launches.",
    "技能管理说明": "Manage skills via Daemon.",
    "诊断说明": "Check relay, protocol, keys, and dependencies.",
    "服务概览说明": "Retains CLI behavior with quick controls.",
    "命名 Tunnel 依赖 Cloudflared 服务（Windows 可管理）。": "Named tunnels rely on Cloudflared service (Windows).",
    "控制端": "Control",
    "移动端": "Mobile",
    "LAN IP": "LAN IP",
    "输出": "Output",
    "共 {count} 条": "{count} total",
    "会话": "Sessions",
    "会话列表": "Sessions",
    "快捷导航": "Quick Nav",
    "日志来源": "Source",
    "当前：{profile}": "Current: {profile}",
    "端口": "Port",
    "运行时间": "Uptime",
    "平台": "Platform",
    "版本": "Version",
    "系统信息获取失败：{message}": "Failed to read system info: {message}",
    "版本读取失败：{message}": "Failed to read version: {message}",
    "日志刷新失败：{message}": "Failed to refresh logs: {message}",
    "清空日志失败：{message}": "Failed to clear logs: {message}",
    "操作失败：{message}": "Action failed: {message}",
    "已请求启动 Relay。": "Relay start requested.",
    "已请求停止 Relay。": "Relay stop requested.",
    "已请求启动 Tunnel。": "Tunnel start requested.",
    "已请求停止 Tunnel。": "Tunnel stop requested.",
    "已请求启动 Daemon。": "Daemon start requested.",
    "已请求停止 Daemon。": "Daemon stop requested.",
    "已请求停止所有服务。": "Stop all services requested.",
    "已请求重载远程桥接。": "Remote bridge reload requested.",
    "已请求启动 {profile}。": "{profile} start requested.",
    "启动失败：{message}": "Start failed: {message}",
    "停止失败：{message}": "Stop failed: {message}",
    "桥接重载失败：{message}": "Bridge reload failed: {message}",
    "Cloudflared 刷新失败：{message}": "Cloudflared refresh failed: {message}",
    "Tunnel 名称为空，无法安装 Cloudflared 服务。": "Tunnel name is empty. Cannot install Cloudflared service.",
    "已请求安装 Cloudflared 服务。": "Cloudflared install requested.",
    "Cloudflared 安装失败：{message}": "Cloudflared install failed: {message}",
    "状态刷新失败：{message}": "Status refresh failed: {message}",
    "已配对（session {id}）。": "Paired (session {id}).",
    "尚未配对。": "Not paired.",
    "提交配对码 {code}，等待远端响应。": "Submitted pairing code {code}, waiting for response.",
    "开始创建配对码...": "Creating pairing code...",
    "等待扫码结果（桌面端只做入口展示）。": "Waiting for scan (desktop shows entry only).",
    "桌面壳初始化完成。": "Desktop shell initialized.",
    "创建配对后可用移动端加入。": "After creating a pair, join from the mobile app.",
    "输入移动端显示的配对码完成绑定。": "Enter the mobile pairing code to finish binding.",
    "配置已加载": "Config loaded.",
    "配置加载失败：{message}": "Config load failed: {message}",
    "配置已保存": "Config saved.",
    "配置保存失败：{message}": "Config save failed: {message}",
    "已刷新": "Refreshed.",
    "技能操作失败：{message}": "Skill operation failed: {message}",
    "安装源为空": "Install source is empty",
    "prepare 完成：{id}": "Prepare done: {id}",
    "installId 为空": "installId is empty",
    "未选择候选项": "No candidates selected",
    "提交完成：total={count}": "Commit done: total={count}",
    "已取消安装会话": "Install session cancelled",
    "安装会话不存在": "Install session not found",
    "控制端地址为空": "Control URL is empty",
    "配对失败": "Pairing failed",
    "配对码为空": "Pairing code is empty",
    "检测控制端健康...": "Checking control health...",
    "启动 Relay 失败": "Relay start failed",
    "当前仅支持查看本机会话的实时日志。": "Realtime is available only for current local session.",
    "路径：{path}": "Path: {path}",
    "备份：{path}": "Backup: {path}",
  },
};

const t = (key: string, params: Record<string, string | number> = {}) => {
  if (configLanguage.value === "zh-CN") {
    return replaceParams(key, params);
  }
  const table = translations[configLanguage.value] ?? {};
  return replaceParams(table[key] ?? key, params);
};

const replaceParams = (text: string, params: Record<string, string | number>) => {
  let output = text;
  for (const [k, v] of Object.entries(params)) {
    output = output.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return output;
};

const statusLabel = (status: ServiceStatus) => {
  if (status === "running") return t("运行中");
  if (status === "starting") return t("启动中");
  if (status === "stopped") return t("已停止");
  return t("异常");
};

const profileLabel = computed(() => {
  if (activeProfile.value === "lan") return "LAN";
  if (activeProfile.value === "tunnel") return "Tunnel";
  return t("未连接");
});

const cloudflaredLabel = computed(() => {
  const state = cloudflaredState.value;
  if (!state) return t("未知");
  if (!state.supported) return t("不支持");
  if (state.status === "missing") return t("未安装");
  if (state.status === "checking") return t("检测中");
  if (state.status === "error") return t("异常");
  if (state.status === "ready" && state.running) return t("运行中");
  if (state.status === "ready") return t("已安装");
  return t("未知");
});

const themeLabel = computed(() => (theme.value === "dark" ? t("浅色") : t("深色")));

const pairStatusLabel = computed(() => {
  if (pairStatus.value === "generating") return t("准备中");
  if (pairStatus.value === "waiting") return t("等待扫码");
  if (pairStatus.value === "success") return t("已完成");
  if (pairStatus.value === "timeout") return t("已超时");
  if (pairStatus.value === "error") return t("失败");
  return t("待命");
});

const monitorReadonlySelection = computed(() => {
  return !!monitorSelectedSessionId.value
    && !!monitorCurrentSessionId.value
    && monitorSelectedSessionId.value !== monitorCurrentSessionId.value;
});

const normalizeConfig = (input: Partial<AppConfig>): AppConfig => {
  const relayPortNum = Number(input.relayPort ?? relayPort.value);
  const relayPortSafe = Number.isFinite(relayPortNum)
    ? Math.min(65535, Math.max(1, Math.floor(relayPortNum)))
    : 3000;
  const tunnelModeSafe = input.tunnelMode === "quick" ? "quick" : "named";
  const profileSafe = input.connectionProfile === "lan" ? "lan" : "tunnel";
  const languageSafe = input.language === "zh-TW" || input.language === "en" ? input.language : "zh-CN";
  return {
    serverUrl: (input.serverUrl ?? serverUrl.value ?? "http://localhost:3000").toString().trim() || "http://localhost:3000",
    namespace: (input.namespace ?? pairingNamespace.value ?? "default").toString().trim() || "default",
    relayPort: relayPortSafe,
    autoStart: Boolean(input.autoStart ?? configAutoStart.value),
    connectionProfile: profileSafe,
    tunnelMode: tunnelModeSafe,
    tunnelName: (input.tunnelName ?? tunnelName.value ?? "").toString().trim(),
    tunnelHostname: (input.tunnelHostname ?? tunnelHostname.value ?? "").toString().trim(),
    language: languageSafe,
  };
};

const currentConfig = () => normalizeConfig({
  serverUrl: serverUrl.value,
  namespace: pairingNamespace.value,
  relayPort: relayPort.value,
  autoStart: configAutoStart.value,
  connectionProfile: configProfile.value,
  tunnelMode: tunnelMode.value,
  tunnelName: tunnelName.value,
  tunnelHostname: tunnelHostname.value,
  language: configLanguage.value,
});
const loadConfigDraft = (): Partial<AppConfig> | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(configDraftStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    return null;
  }
};
const applyConfigDraft = () => {
  const draft = loadConfigDraft();
  if (!draft) return;
  const normalized = normalizeConfig(draft);
  serverUrl.value = normalized.serverUrl;
  pairingNamespace.value = normalized.namespace;
  relayPort.value = normalized.relayPort;
  configAutoStart.value = normalized.autoStart;
  configProfile.value = normalized.connectionProfile;
  tunnelMode.value = normalized.tunnelMode;
  tunnelName.value = normalized.tunnelName;
  tunnelHostname.value = normalized.tunnelHostname;
  configLanguage.value = normalized.language;
  doctorControlUrl.value = normalized.serverUrl;
  doctorPublicUrl.value = normalized.tunnelHostname ? `https://${normalized.tunnelHostname}` : "";
};
const saveConfigDraft = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(configDraftStorageKey, JSON.stringify(currentConfig()));
};

const configDirty = computed(() => {
  if (!configSnapshot.value) return false;
  return JSON.stringify(currentConfig()) !== JSON.stringify(configSnapshot.value);
});

const doctorStatusLabel = computed(() => {
  if (!doctorReport.value) return t("待命");
  return doctorReport.value.failed === 0 ? t("通过") : t("异常");
});

const monitorRealtimeLabel = computed(() => {
  if (monitorRealtime.value.status === "connected") return t("实时订阅已连接");
  if (monitorRealtime.value.status === "disconnected") return t("实时订阅已断开");
  if (monitorRealtime.value.status === "error") {
    return t("实时订阅失败：{message}", { message: monitorRealtime.value.message || "-" });
  }
  return t("等待连接");
});

const uptimeLabel = computed(() => formatUptime(uptimeSeconds.value));

const logSources = computed(() => {
  const sources = new Set<string>();
  allLogs.value.forEach((entry) => sources.add(entry.source));
  return ["all", ...Array.from(sources).sort()];
});

const filteredLogs = computed(() => {
  const keyword = logSearch.value.trim().toLowerCase();
  const source = logFilter.value;
  return allLogs.value.filter((entry) => {
    if (source !== "all" && entry.source !== source) return false;
    if (!keyword) return true;
    return entry.text.toLowerCase().includes(keyword) || entry.source.toLowerCase().includes(keyword);
  });
});

const dashboardLogs = computed(() => allLogs.value.slice(0, 8));
const daemonSessions = computed(() => daemonStatus.value?.sessions ?? []);
const daemonSessionPreview = computed(() => daemonSessions.value.slice(0, 6));

const localRelayUrl = computed(() => {
  if (serviceState.value.relay.status !== "running") return null;
  return serviceState.value.relay.url ?? null;
});

const pairServerUrl = computed(() => localRelayUrl.value ?? serverUrl.value);
const isLanPair = computed(() => !pairServerUrl.value.startsWith("https://"));
const displayPairUrl = computed(() => {
  const baseUrl = pairServerUrl.value;
  if (!pairLanIp.value) return baseUrl;
  return baseUrl.replace(/localhost|127\.0\.0\.1/i, pairLanIp.value);
});

const statusTone = (status: ServiceStatus) => {
  if (status === "running") return "online";
  if (status === "starting") return "warn";
  return "offline";
};

const badgeTone = (status: ServiceStatus) => {
  if (status === "running") return "green";
  if (status === "starting") return "blue";
  return "red";
};

const readinessLabel = (value: boolean | null) => {
  if (value === null) return t("未知");
  return value ? t("可用") : t("不可用");
};

const normalizeRelayPort = () => {
  const port = Number(relayPort.value);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 3000;
  return Math.floor(port);
};

const formatUptime = (sec: number) => {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const setTheme = (value: "dark" | "light") => {
  document.documentElement.dataset.theme = value;
  if (isTauri()) {
    void getCurrentWindow().setTheme(value);
  }
};

const pushUiLog = (text: string, source = "ops", level = "info") => {
  const entry: AppLogEntry = {
    ts: Date.now(),
    source,
    level,
    text,
  };
  uiLogs.value = [entry, ...uiLogs.value].slice(0, 80);
};

const normalizeLogEntries = (entries: AppLogEntry[]) => {
  return entries.slice().sort((a, b) => b.ts - a.ts);
};

const allLogs = computed(() => {
  const combined = [...appLogs.value, ...uiLogs.value];
  return normalizeLogEntries(combined);
});

const refreshAppLogs = async () => {
  try {
    const entries = await invoke<AppLogEntry[]>("app_logs");
    appLogs.value = normalizeLogEntries(entries);
  } catch (err: any) {
    pushUiLog(t("日志刷新失败：{message}", { message: err?.message || String(err) }));
  }
};

const clearAppLogs = async () => {
  try {
    await invoke("app_logs_clear");
    appLogs.value = [];
    uiLogs.value = [];
  } catch (err: any) {
    pushUiLog(t("清空日志失败：{message}", { message: err?.message || String(err) }));
  }
};

const applyServiceSnapshot = (snapshot: ServiceSnapshot) => {
  serviceState.value = snapshot.service;
  cloudflaredState.value = snapshot.cloudflared;
  activeProfile.value = snapshot.profile;
};

const refreshDaemonStatus = async () => {
  try {
    daemonStatus.value = await invoke<DaemonStatus>("daemon_status");
  } catch (err: any) {
    pushUiLog(t("状态刷新失败：{message}", { message: err?.message || String(err) }));
  }
};

const refreshStatus = async () => {
  try {
    const [snapshot, appStatus] = await Promise.all([
      invoke<ServiceSnapshot>("service_state"),
      invoke<{ paired: boolean; session?: { session_id: string } }>("app_status"),
    ]);
    applyServiceSnapshot(snapshot);
    if (appStatus?.paired) {
      pushUiLog(t("已配对（session {id}）。", { id: appStatus.session?.session_id ?? "?" }));
    } else {
      pushUiLog(t("尚未配对。"));
    }
    void refreshDaemonStatus();
    void refreshAppLogs();
    void refreshReadiness();
    void refreshSystemInfo();
    void refreshAppVersion();
  } catch (err: any) {
    pushUiLog(t("状态刷新失败：{message}", { message: err?.message || String(err) }));
  }
};

const refreshSystemInfo = async () => {
  if (!isTauri()) return;
  try {
    systemInfo.value = await invoke<SystemInfo>("system_info");
  } catch (err: any) {
    pushUiLog(t("系统信息获取失败：{message}", { message: err?.message || String(err) }));
  }
};

const refreshAppVersion = async () => {
  if (!isTauri()) return;
  try {
    appVersion.value = await getVersion();
  } catch (err: any) {
    pushUiLog(t("版本读取失败：{message}", { message: err?.message || String(err) }));
  }
};

const runServiceAction = async (action: () => Promise<ServiceSnapshot>, successMessage: string) => {
  try {
    const snapshot = await action();
    applyServiceSnapshot(snapshot);
    void refreshDaemonStatus();
    pushUiLog(successMessage);
    void refreshAppLogs();
  } catch (err: any) {
    pushUiLog(t("操作失败：{message}", { message: err?.message || String(err) }));
  }
};

const startRelay = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_start_relay", { payload: { relayPort: normalizeRelayPort() } }),
  t("已请求启动 Relay。"),
);

const stopRelay = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_stop_relay"),
  t("已请求停止 Relay。"),
);

const restartRelay = async () => {
  await stopRelay();
  await startRelay();
};

const startTunnel = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_start_tunnel", {
    payload: {
      relayPort: normalizeRelayPort(),
      tunnelMode: tunnelMode.value,
      tunnelName: tunnelName.value,
      tunnelHostname: tunnelHostname.value,
    },
  }),
  t("已请求启动 Tunnel。"),
);

const stopTunnel = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_stop_tunnel"),
  t("已请求停止 Tunnel。"),
);

const restartTunnel = async () => {
  await stopTunnel();
  await startTunnel();
};

const startDaemon = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_start_daemon", { payload: { serverUrl: serverUrl.value } }),
  t("已请求启动 Daemon。"),
);

const stopDaemon = async () => runServiceAction(
  () => invoke<ServiceSnapshot>("service_stop_daemon"),
  t("已请求停止 Daemon。"),
);

const restartDaemon = async () => {
  await stopDaemon();
  await startDaemon();
};

const startProfile = async (profile: "lan" | "tunnel"): Promise<boolean> => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("service_start_profile", {
      payload: {
        profile,
        serverUrl: serverUrl.value,
        relayPort: normalizeRelayPort(),
        tunnelMode: tunnelMode.value,
        tunnelName: tunnelName.value,
        tunnelHostname: tunnelHostname.value,
        namespace: pairingNamespace.value.trim() || undefined,
      },
    });
    applyServiceSnapshot(snapshot);
    pushUiLog(t("已请求启动 {profile}。", { profile: profile === "lan" ? "LAN" : "Tunnel" }));
    return true;
  } catch (err: any) {
    pushUiLog(t("启动失败：{message}", { message: err?.message || String(err) }));
    return false;
  }
};

const stopAll = async () => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("service_stop_all");
    applyServiceSnapshot(snapshot);
    pushUiLog(t("已请求停止所有服务。"));
  } catch (err: any) {
    pushUiLog(t("停止失败：{message}", { message: err?.message || String(err) }));
  }
};

const reloadBridge = async () => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("remote_bridge_reload");
    applyServiceSnapshot(snapshot);
    pushUiLog(t("已请求重载远程桥接。"));
  } catch (err: any) {
    pushUiLog(t("桥接重载失败：{message}", { message: err?.message || String(err) }));
  }
};

const refreshCloudflared = async () => {
  try {
    const state = await invoke<CloudflaredServiceState>("cloudflared_refresh");
    cloudflaredState.value = state;
  } catch (err: any) {
    pushUiLog(t("Cloudflared 刷新失败：{message}", { message: err?.message || String(err) }));
  }
};

const installCloudflared = async () => {
  if (!tunnelName.value.trim()) {
    pushUiLog(t("Tunnel 名称为空，无法安装 Cloudflared 服务。"));
    return;
  }
  try {
    const state = await invoke<CloudflaredServiceState>("cloudflared_install", {
      payload: {
        tunnelName: tunnelName.value.trim(),
        relayPort: normalizeRelayPort(),
      },
    });
    cloudflaredState.value = state;
    pushUiLog(t("已请求安装 Cloudflared 服务。"));
  } catch (err: any) {
    pushUiLog(t("Cloudflared 安装失败：{message}", { message: err?.message || String(err) }));
  }
};

const confirmCloudflaredInstall = async () => {
  if (!cloudflaredConfirm.value) {
    cloudflaredConfirm.value = true;
    pushUiLog(t("再次点击确认安装 Cloudflared 服务。"));
    setTimeout(() => {
      cloudflaredConfirm.value = false;
    }, 4000);
    return;
  }
  cloudflaredConfirm.value = false;
  await installCloudflared();
};

const healthUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/health`;

const probeHealth = async (baseUrl: string, timeoutMs = 3000): Promise<boolean> => {
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
};

const waitHealth = async (baseUrl: string, timeoutMs = 15000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(baseUrl, 3000)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

const isLocalServerUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(trimmed);
  }
};

const refreshReadiness = async () => {
  pairChecking.value = true;
  try {
    pairLanIp.value = await invoke<string | null>("local_ipv4");
    const [controlOk, mobileOk] = await Promise.all([
      probeHealth(pairServerUrl.value, 3000),
      isLanPair.value ? probeHealth(displayPairUrl.value, 3000) : Promise.resolve<boolean | null>(null),
    ]);
    pairControlReady.value = controlOk;
    pairMobileReady.value = mobileOk;
  } finally {
    pairChecking.value = false;
  }
};

const ensureControlReady = async (): Promise<boolean> => {
  pairOpMessage.value = t("检测控制端健康...");
  let ready = await probeHealth(pairServerUrl.value, 3000);
  if (ready) {
    pairOpMessage.value = "";
    return true;
  }

  if (isLocalServerUrl(serverUrl.value)) {
    pairOpMessage.value = t("控制端未就绪，尝试启动本地 Relay...");
    const started = await startProfile("lan");
    if (!started) {
      pairOpMessage.value = t("启动 Relay 失败");
      await refreshReadiness();
      return false;
    }
    ready = await waitHealth(pairServerUrl.value, 15000);
    pairOpMessage.value = ready ? "" : t("控制端启动超时");
    await refreshReadiness();
    return ready;
  }

  pairOpMessage.value = t("控制端不可用，请检查地址或网络");
  await refreshReadiness();
  return false;
};

const MONITOR_MAX_LINES = 2000;

const shortSessionId = (value: string) => value.slice(0, 8);

const goToSection = (id: string) => {
  activeSection.value = id;
  nextTick(() => {
    contentRef.value?.scrollTo({ top: 0, behavior: "smooth" });
  });
};
const slideDirection = ref<"slide-up" | "slide-down">("slide-up");

const formatMonitorText = (value: string) => {
  const flattened = value.replace(/\r?\n/g, "\\n");
  return flattened.length > 300 ? `${flattened.slice(0, 300)}...` : flattened;
};

const applyMonitorSelection = (sessionId: string | null) => {
  monitorSelectedSessionId.value = sessionId;
  monitorLines.value = sessionId ? monitorLogs.get(sessionId) ?? [] : [];
};

const fetchMonitorSessions = async () => {
  if (monitorPolling.sessions) return;
  monitorPolling.sessions = true;
  try {
    const resp = await invoke<MonitorSessionsResponse>("monitor_sessions");
    const sessions = resp.sessions ?? [];
    monitorSessions.value = sessions;
    monitorCurrentSessionId.value = resp.currentSessionId ?? null;
    monitorReady.value = true;
    monitorError.value = null;
    monitorStatus.value = t("已连接 · {count} 会话", { count: sessions.length });

    const selected = monitorSelectedSessionId.value;
    const selectedExists = !!selected && sessions.some((item) => item.sessionId === selected);
    if (!selectedExists) {
      const fallback = resp.currentSessionId ?? sessions[0]?.sessionId ?? null;
      applyMonitorSelection(fallback);
    } else if (selected) {
      monitorLines.value = monitorLogs.get(selected) ?? [];
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    monitorReady.value = false;
    if (message.includes("尚未配对")) {
      monitorStatus.value = t("尚未配对");
      monitorError.value = null;
      monitorSessions.value = [];
      monitorCurrentSessionId.value = null;
      applyMonitorSelection(null);
    } else {
      monitorStatus.value = t("监控不可用");
      monitorError.value = message;
    }
  } finally {
    monitorPolling.sessions = false;
  }
};

const appendMonitorLine = (line: MonitorLine) => {
  const sessionId = line.sessionId;
  const seen = monitorSeenIds.get(sessionId) ?? new Set<string>();
  if (seen.has(line.id)) return;
  seen.add(line.id);
  monitorSeenIds.set(sessionId, seen);
  const prev = monitorLogs.get(sessionId) ?? [];
  const next = [...prev, { ...line, text: formatMonitorText(line.text) }].slice(-MONITOR_MAX_LINES);
  monitorLogs.set(sessionId, next);
  const cursor = monitorAfterCursor.get(sessionId) ?? 0;
  if (line.ts > cursor) {
    monitorAfterCursor.set(sessionId, line.ts);
  }
  if (monitorSelectedSessionId.value === sessionId) {
    monitorLines.value = next;
  }
};

const fetchMonitorMessages = async () => {
  if (monitorPolling.messages) return;
  const sessionId = monitorCurrentSessionId.value;
  if (!sessionId) return;
  monitorPolling.messages = true;
  try {
    const afterCursor = monitorAfterCursor.get(sessionId) ?? 0;
    const resp = await invoke<MonitorMessagesResponse>("monitor_messages", {
      sessionId,
      afterCursor,
      limit: 200,
    });
    const lines = resp.lines ?? [];
    if (resp.nextCursor !== undefined && resp.nextCursor !== null) {
      monitorAfterCursor.set(sessionId, resp.nextCursor);
    }

    if (lines.length > 0) {
      for (const line of lines) {
        appendMonitorLine(line);
      }
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    monitorError.value = message;
    monitorStatus.value = t("监控不可用");
    monitorReady.value = false;
  } finally {
    monitorPolling.messages = false;
  }
};

const refreshMonitorNow = async () => {
  await fetchMonitorSessions();
  await fetchMonitorMessages();
};

const clearMonitorLines = () => {
  const sessionId = monitorSelectedSessionId.value;
  if (!sessionId) return;
  monitorLogs.set(sessionId, []);
  monitorSeenIds.set(sessionId, new Set());
  if (monitorSelectedSessionId.value === sessionId) {
    monitorLines.value = [];
  }
};

const selectMonitorSession = (sessionId: string) => {
  applyMonitorSelection(sessionId);
};

const loadConfig = async (options?: { applyDraft?: boolean }) => {
  configLoading.value = true;
  try {
    const loaded = await invoke<AppConfig>("config_load");
    const normalized = normalizeConfig(loaded);
    configSnapshot.value = normalized;
    serverUrl.value = normalized.serverUrl;
    pairingNamespace.value = normalized.namespace;
    relayPort.value = normalized.relayPort;
    configAutoStart.value = normalized.autoStart;
    configProfile.value = normalized.connectionProfile;
    tunnelMode.value = normalized.tunnelMode;
    tunnelName.value = normalized.tunnelName;
    tunnelHostname.value = normalized.tunnelHostname;
    configLanguage.value = normalized.language;
    doctorControlUrl.value = normalized.serverUrl;
    doctorPublicUrl.value = normalized.tunnelHostname ? `https://${normalized.tunnelHostname}` : "";
    if (options?.applyDraft) {
      applyConfigDraft();
    }
    configMessage.value = t("配置已加载");
    if (configAutoStart.value) {
      await maybeAutoStart(configProfile.value);
    }
  } catch (err: any) {
    configMessage.value = t("配置加载失败：{message}", { message: err?.message || String(err) });
  } finally {
    configLoading.value = false;
    if (options?.applyDraft) {
      configBootstrapped.value = true;
      saveConfigDraft();
    }
  }
};

const saveConfig = async () => {
  configSaving.value = true;
  try {
    const payload = currentConfig();
    const saved = await invoke<AppConfig>("config_save", { config: payload });
    const normalized = normalizeConfig(saved);
    configSnapshot.value = normalized;
    configMessage.value = t("配置已保存");
  } catch (err: any) {
    configMessage.value = t("配置保存失败：{message}", { message: err?.message || String(err) });
  } finally {
    configSaving.value = false;
  }
};

const maybeAutoStart = async (profile: "lan" | "tunnel") => {
  if (autoStartTriggered) return;
  autoStartTriggered = true;
  await startProfile(profile);
};

const setSkillStatus = (text: string, error = false) => {
  skillStatus.value = text;
  skillError.value = error ? text : "";
};

const refreshSkills = async () => {
  if (skillBusy.value) return;
  skillBusy.value = true;
  try {
    const [installed, logs] = await Promise.all([
      invoke<SkillItem[]>("skills_list", { scope: skillScope.value }),
      invoke<SkillLogItem[]>("skills_logs", { limit: 20 }),
    ]);
    skillInstalled.value = installed;
    skillLogs.value = logs;
    if (skillInstallId.value.trim()) {
      const status = await invoke<SkillInstallStatusResponse>("skills_install_status", { installId: skillInstallId.value });
      skillCandidates.value = status.candidates ?? [];
      const validIds = new Set(skillCandidates.value.map((item) => item.id));
      skillSelected.value = skillSelected.value.filter((id) => validIds.has(id));
    }
    setSkillStatus(t("已刷新"));
  } catch (err: any) {
    setSkillStatus(t("技能操作失败：{message}", { message: err?.message || String(err) }), true);
  } finally {
    skillBusy.value = false;
  }
};

const prepareSkills = async () => {
  const source = skillSource.value.trim();
  if (!source) {
    setSkillStatus(t("安装源为空"), true);
    return;
  }
  if (skillBusy.value) return;
  skillBusy.value = true;
  try {
    const resp = await invoke<SkillInstallPrepareResponse>("skills_install_prepare", {
      source,
      scope: skillScope.value,
    });
    skillInstallId.value = resp.installId;
    skillCandidates.value = resp.candidates ?? [];
    skillSelected.value = skillCandidates.value.filter((item) => item.valid).map((item) => item.id);
    setSkillStatus(t("prepare 完成：{id}", { id: resp.installId }));
    const logs = await invoke<SkillLogItem[]>("skills_logs", { limit: 20 });
    skillLogs.value = logs;
  } catch (err: any) {
    setSkillStatus(t("技能操作失败：{message}", { message: err?.message || String(err) }), true);
  } finally {
    skillBusy.value = false;
  }
};

const toggleSkillCandidate = (candidate: SkillCandidate) => {
  if (!candidate.valid) return;
  const id = candidate.id;
  if (!id) return;
  if (skillSelected.value.includes(id)) {
    skillSelected.value = skillSelected.value.filter((item) => item !== id);
    return;
  }
  skillSelected.value = [...skillSelected.value, id];
};

const selectValidCandidates = () => {
  skillSelected.value = skillCandidates.value.filter((item) => item.valid).map((item) => item.id);
};

const commitSkills = async (policy: "skip" | "overwrite") => {
  if (!skillInstallId.value.trim()) {
    setSkillStatus(t("installId 为空"), true);
    return;
  }
  if (skillSelected.value.length === 0) {
    setSkillStatus(t("未选择候选项"), true);
    return;
  }
  if (skillBusy.value) return;
  skillBusy.value = true;
  try {
    const resp = await invoke<SkillInstallCommitResponse>("skills_install_commit", {
      installId: skillInstallId.value,
      selected: skillSelected.value,
      conflictPolicy: policy,
    });
    setSkillStatus(t("提交完成：total={count}", { count: resp.total }));
    await refreshSkills();
  } catch (err: any) {
    setSkillStatus(t("技能操作失败：{message}", { message: err?.message || String(err) }), true);
  } finally {
    skillBusy.value = false;
  }
};

const cancelSkills = async () => {
  if (!skillInstallId.value.trim()) {
    setSkillStatus(t("installId 为空"), true);
    return;
  }
  if (skillBusy.value) return;
  skillBusy.value = true;
  try {
    const resp = await invoke<SkillInstallCancelResponse>("skills_install_cancel", {
      installId: skillInstallId.value,
    });
    skillInstallId.value = "";
    skillCandidates.value = [];
    skillSelected.value = [];
    setSkillStatus(resp.existed ? t("已取消安装会话") : t("安装会话不存在"));
    const logs = await invoke<SkillLogItem[]>("skills_logs", { limit: 20 });
    skillLogs.value = logs;
  } catch (err: any) {
    setSkillStatus(t("技能操作失败：{message}", { message: err?.message || String(err) }), true);
  } finally {
    skillBusy.value = false;
  }
};

const runDoctor = async () => {
  if (!doctorControlUrl.value.trim()) {
    doctorError.value = t("控制端地址为空");
    return;
  }
  doctorRunning.value = true;
  doctorError.value = "";
  try {
    const report = await invoke<DoctorReport>("doctor_run", {
      controlServerUrl: doctorControlUrl.value.trim(),
      publicServerUrl: doctorPublicUrl.value.trim() || undefined,
    });
    doctorReport.value = report;
  } catch (err: any) {
    doctorError.value = err?.message || String(err);
  } finally {
    doctorRunning.value = false;
  }
};

const clearPairingPoll = () => {
  if (pairPollTimer) {
    clearTimeout(pairPollTimer);
    pairPollTimer = null;
  }
};

const schedulePairingPoll = () => {
  clearPairingPoll();
  pairPollTimer = setTimeout(async () => {
    if (pairStatus.value !== "waiting") return;
    try {
      const result = await invoke<PairingPollResponse>("pairing_poll", { code: pairingCode.value });
      if (result.status === "idle") {
        pairStatus.value = "idle";
        pairError.value = result.message || "";
        return;
      }
      if (result.status === "success") {
        pairStatus.value = "success";
        pairError.value = "";
        await refreshStatus();
        return;
      }
      if (result.status === "timeout") {
        pairStatus.value = "timeout";
        pairError.value = result.message || "";
        return;
      }
      if (result.status === "error") {
        pairStatus.value = "error";
        pairError.value = result.message || t("配对失败");
        return;
      }
    } catch (err: any) {
      pairStatus.value = "error";
      pairError.value = err?.message || String(err);
      return;
    }
    schedulePairingPoll();
  }, 2000);
};

const resetPairingState = () => {
  pairStatus.value = "idle";
  pairError.value = "";
  pairOpMessage.value = "";
  pairQrData.value = null;
  clearPairingPoll();
};

const buildPairingQr = async (code: string, namespace: string) => {
  const payload = JSON.stringify({
    server: displayPairUrl.value,
    code,
    namespace,
  });
  pairQrData.value = await QRCode.toDataURL(payload, { width: 168, margin: 1 });
};

const startPairing = async () => {
  resetPairingState();
  pairStatus.value = "generating";
  const ready = await ensureControlReady();
  if (!ready) {
    pairStatus.value = "error";
    pairError.value = pairOpMessage.value || t("控制端不可用");
    return;
  }
  try {
    const resp = await invoke<PairingPrepareResponse>("pairing_prepare", {
      serverUrl: pairServerUrl.value,
      namespace: pairingNamespace.value.trim() || undefined,
    });
    pairingCode.value = resp.pairing_code;
    pairingNamespace.value = resp.namespace;
    await refreshReadiness();
    await buildPairingQr(resp.pairing_code, resp.namespace);
    pairStatus.value = "waiting";
    pairOpMessage.value = "";
    schedulePairingPoll();
  } catch (err: any) {
    pairStatus.value = "error";
    pairError.value = err?.message || String(err);
  }
};

const cancelPairing = async () => {
  clearPairingPoll();
  try {
    await invoke("pairing_cancel");
    pushUiLog(t("已取消配对。"));
  } catch (err: any) {
    pushUiLog(t("取消配对失败：{message}", { message: err?.message || String(err) }));
  } finally {
    resetPairingState();
  }
};

const joinPairing = async () => {
  resetPairingState();
  pairStatus.value = "generating";
  const ready = await ensureControlReady();
  if (!ready) {
    pairStatus.value = "error";
    pairError.value = pairOpMessage.value || t("控制端不可用");
    return;
  }
  const code = pairingCode.value.trim();
  if (!code) {
    pairStatus.value = "error";
    pairError.value = t("配对码为空");
    return;
  }
  try {
    await invoke("pairing_join", { serverUrl: pairServerUrl.value, code });
    pairStatus.value = "success";
    pairError.value = "";
    pairOpMessage.value = "";
    await refreshStatus();
  } catch (err: any) {
    pairStatus.value = "error";
    pairError.value = err?.message || String(err);
  }
};

const submitPairing = () => {
  if (pairingMode.value === "join") {
    pushUiLog(t("提交配对码 {code}，等待远端响应。", { code: pairingCode.value.trim() || "-" }));
    void joinPairing();
    return;
  }
  pushUiLog(t("开始创建配对码..."));
  void startPairing();
};

const scanPairing = () => {
  pushUiLog(t("等待扫码结果（桌面端只做入口展示）。"));
};

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
};

onMounted(() => {
  loadSidebarWidth();
  loadUiPrefs();
  uiBootstrapped.value = true;
  saveUiPrefs();
  setTheme(theme.value);
  pushUiLog(t("桌面壳初始化完成。"));
  void loadConfig({ applyDraft: true });
  refreshStatus();
  void refreshReadiness();
  void refreshMonitorNow();
  void refreshSystemInfo();
  void refreshAppVersion();
  void refreshAppLogs();
  uptimeTimer = setInterval(() => {
    uptimeSeconds.value += 1;
  }, 1000);
  if (isTauri()) {
    void (async () => {
      monitorLineUnlisten = await listen<MonitorLine>("monitor-line", (event) => {
        appendMonitorLine(event.payload);
      });
      monitorRealtimeUnlisten = await listen<MonitorRealtimeStatus>("monitor-realtime", (event) => {
        monitorRealtime.value = event.payload;
      });
    })();
  }
  monitorSessionsTimer = setInterval(() => { void fetchMonitorSessions(); }, 3000);
  monitorMessagesTimer = setInterval(() => { void fetchMonitorMessages(); }, 5000);
  appLogsTimer = setInterval(() => { void refreshAppLogs(); }, 4000);
});

watch(theme, (value) => setTheme(value));

watch(configLanguage, (value) => {
  document.documentElement.lang = value;
  if (!monitorReady.value && !monitorError.value) {
    monitorStatus.value = t("等待连接");
  }
}, { immediate: true });

watch(logSources, (sources) => {
  if (!sources.includes(logFilter.value)) {
    logFilter.value = "all";
  }
});

watch(relayPort, (value) => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 1 || next > 65535) {
    return;
  }
  if (serviceState.value.relay.status === "running" || serviceState.value.relay.status === "starting") {
    return;
  }
  serviceState.value.relay.port = next;
  serviceState.value.relay.url = `http://localhost:${next}`;
});

watch(pairingMode, () => {
  if (pairStatus.value === "waiting") {
    void cancelPairing();
    return;
  }
  resetPairingState();
});

watch(activeSection, (value, prev) => {
  const currentIndex = sectionOrder.indexOf(value);
  const prevIndex = sectionOrder.indexOf(prev);
  if (currentIndex === -1 || prevIndex === -1) return;
  slideDirection.value = currentIndex >= prevIndex ? "slide-up" : "slide-down";
});

watch(
  () => [
    theme.value,
    sidebarCollapsed.value,
    activeSection.value,
    logFilter.value,
    logSearch.value,
    pairingMode.value,
    skillScope.value,
    skillSource.value,
  ],
  () => {
    if (!uiBootstrapped.value) return;
    saveUiPrefs();
  },
);

watch(
  () => [
    serverUrl.value,
    pairingNamespace.value,
    relayPort.value,
    configAutoStart.value,
    configProfile.value,
    tunnelMode.value,
    tunnelName.value,
    tunnelHostname.value,
    configLanguage.value,
  ],
  () => {
    if (!configBootstrapped.value) return;
    saveConfigDraft();
  },
);

onBeforeUnmount(() => {
  clearPairingPoll();
  if (sidebarResizeCleanup) {
    sidebarResizeCleanup();
    sidebarResizeCleanup = null;
  }
  if (monitorSessionsTimer) {
    clearInterval(monitorSessionsTimer);
    monitorSessionsTimer = null;
  }
  if (monitorMessagesTimer) {
    clearInterval(monitorMessagesTimer);
    monitorMessagesTimer = null;
  }
  if (appLogsTimer) {
    clearInterval(appLogsTimer);
    appLogsTimer = null;
  }
  if (uptimeTimer) {
    clearInterval(uptimeTimer);
    uptimeTimer = null;
  }
  if (monitorLineUnlisten) {
    monitorLineUnlisten();
    monitorLineUnlisten = null;
  }
  if (monitorRealtimeUnlisten) {
    monitorRealtimeUnlisten();
    monitorRealtimeUnlisten = null;
  }
});
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'sidebar-collapsed': sidebarCollapsed, 'sidebar-resizing': sidebarResizing }"
    :style="{ '--sidebar-width': `${sidebarWidth}px` }"
  >
    <SidebarNav
      :items="sidebarItems"
      :active-id="activeSection"
      :collapsed="sidebarCollapsed"
      :on-select="goToSection"
      :on-toggle="toggleSidebar"
      :t="t"
    />
    <div v-show="!sidebarCollapsed" class="sidebar-resizer" @pointerdown="startResizeSidebar"></div>
    <div class="app-main">
      <TopBar
        :theme="theme"
        :theme-label="themeLabel"
        :t="t"
        :toggle-theme="toggleTheme"
      />
      <div ref="contentRef" class="content">
        <Transition :name="slideDirection" mode="out-in">
          <DashboardSection
            v-if="activeSection === 'dashboard'"
            key="dashboard"
            :profile-label="profileLabel"
            :service-state="serviceState"
            :config-dirty="configDirty"
            :server-url="serverUrl"
            :pairing-namespace="pairingNamespace"
            :relay-port="relayPort"
            :tunnel-mode="tunnelMode"
            :status-label="statusLabel"
            :badge-tone="badgeTone"
            :status-tone="statusTone"
            :daemon-sessions="daemonSessions"
            :daemon-session-preview="daemonSessionPreview"
            :quick-links="quickLinks"
            :go-to-section="goToSection"
            :short-session-id="shortSessionId"
            :system-info="systemInfo"
            :uptime-label="uptimeLabel"
            :app-version="appVersion"
            :dashboard-logs="dashboardLogs"
            :t="t"
          />
          <ServicesSection
            v-else-if="activeSection === 'services'"
            key="services"
            v-model:server-url="serverUrl"
            v-model:relay-port="relayPort"
            v-model:tunnel-mode="tunnelMode"
            v-model:tunnel-name="tunnelName"
            v-model:tunnel-hostname="tunnelHostname"
            :profile-label="profileLabel"
            :service-state="serviceState"
            :status-label="statusLabel"
            :badge-tone="badgeTone"
            :refresh-status="refreshStatus"
            :start-relay="startRelay"
            :stop-relay="stopRelay"
            :restart-relay="restartRelay"
            :start-daemon="startDaemon"
            :stop-daemon="stopDaemon"
            :restart-daemon="restartDaemon"
            :start-tunnel="startTunnel"
            :stop-tunnel="stopTunnel"
            :restart-tunnel="restartTunnel"
            :start-profile="startProfile"
            :stop-all="stopAll"
            :reload-bridge="reloadBridge"
            :t="t"
          />
          <CloudflaredSection
            v-else-if="activeSection === 'cloudflared'"
            key="cloudflared"
            :cloudflared-state="cloudflaredState"
            :cloudflared-label="cloudflaredLabel"
            :cloudflared-confirm="cloudflaredConfirm"
            :refresh-cloudflared="refreshCloudflared"
            :confirm-cloudflared-install="confirmCloudflaredInstall"
            :t="t"
          />
          <PairingSection
            v-else-if="activeSection === 'pairing'"
            key="pairing"
            v-model:pairing-mode="pairingMode"
            v-model:pairing-namespace="pairingNamespace"
            v-model:pairing-code="pairingCode"
            :pair-status="pairStatus"
            :pair-status-label="pairStatusLabel"
            :pair-error="pairError"
            :pair-qr-data="pairQrData"
            :pair-op-message="pairOpMessage"
            :pair-checking="pairChecking"
            :pair-control-ready="pairControlReady"
            :pair-mobile-ready="pairMobileReady"
            :pair-lan-ip="pairLanIp"
            :pair-server-url="pairServerUrl"
            :display-pair-url="displayPairUrl"
            :is-lan-pair="isLanPair"
            :readiness-label="readinessLabel"
            :submit-pairing="submitPairing"
            :scan-pairing="scanPairing"
            :cancel-pairing="cancelPairing"
            :refresh-readiness="refreshReadiness"
            :t="t"
          />
          <MonitorSection
            v-else-if="activeSection === 'monitor'"
            key="monitor"
            :monitor-ready="monitorReady"
            :monitor-status="monitorStatus"
            :monitor-realtime="monitorRealtime"
            :monitor-realtime-label="monitorRealtimeLabel"
            :monitor-error="monitorError"
            :monitor-sessions="monitorSessions"
            :monitor-selected-session-id="monitorSelectedSessionId"
            :monitor-lines="monitorLines"
            :monitor-readonly-selection="monitorReadonlySelection"
            :short-session-id="shortSessionId"
            :refresh-monitor-now="refreshMonitorNow"
            :clear-monitor-lines="clearMonitorLines"
            :select-monitor-session="selectMonitorSession"
            :t="t"
          />
          <ConfigSection
            v-else-if="activeSection === 'config'"
            key="config"
            v-model:server-url="serverUrl"
            v-model:pairing-namespace="pairingNamespace"
            v-model:relay-port="relayPort"
            v-model:config-auto-start="configAutoStart"
            v-model:config-profile="configProfile"
            v-model:tunnel-mode="tunnelMode"
            v-model:tunnel-name="tunnelName"
            v-model:tunnel-hostname="tunnelHostname"
            v-model:config-language="configLanguage"
            :config-dirty="configDirty"
            :config-loading="configLoading"
            :config-saving="configSaving"
            :config-message="configMessage"
            :load-config="loadConfig"
            :save-config="saveConfig"
            :t="t"
          />
          <SkillsSection
            v-else-if="activeSection === 'skills'"
            key="skills"
            v-model:skill-source="skillSource"
            v-model:skill-scope="skillScope"
            v-model:skill-install-id="skillInstallId"
            :skill-candidates="skillCandidates"
            :skill-selected="skillSelected"
            :skill-installed="skillInstalled"
            :skill-logs="skillLogs"
            :skill-status="skillStatus"
            :skill-error="skillError"
            :skill-busy="skillBusy"
            :prepare-skills="prepareSkills"
            :refresh-skills="refreshSkills"
            :select-valid-candidates="selectValidCandidates"
            :commit-skills="commitSkills"
            :cancel-skills="cancelSkills"
            :toggle-skill-candidate="toggleSkillCandidate"
            :t="t"
          />
          <DoctorSection
            v-else-if="activeSection === 'doctor'"
            key="doctor"
            v-model:doctor-control-url="doctorControlUrl"
            v-model:doctor-public-url="doctorPublicUrl"
            :doctor-running="doctorRunning"
            :doctor-report="doctorReport"
            :doctor-error="doctorError"
            :doctor-status-label="doctorStatusLabel"
            :run-doctor="runDoctor"
            :t="t"
          />
          <LogsSection
            v-else
            key="logs"
            v-model:log-filter="logFilter"
            v-model:log-search="logSearch"
            :log-sources="logSources"
            :filtered-logs="filteredLogs"
            :refresh-app-logs="refreshAppLogs"
            :clear-app-logs="clearAppLogs"
            :t="t"
          />
        </Transition>
      </div>
    </div>
  </main>
</template>


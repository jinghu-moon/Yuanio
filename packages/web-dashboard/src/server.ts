import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const app = new Hono();
const PORT = Number(process.env.DASHBOARD_PORT) || 3001;
const DAEMON_STATE_PATH = process.env.YUANIO_DAEMON_STATE || join(homedir(), ".yuanio", "daemon.json");
const DASHBOARD_BASE_PATH = normalizeBasePath(
  process.env.YUANIO_DASHBOARD_BASE_PATH || process.env.YUANIO_BASE_PATH || "",
);

interface DaemonState {
  pid: number;
  port: number;
  version: string;
  startedAt: string;
  sessions: string[];
}

function normalizeBasePath(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withLeading.replace(/\/+$/, "");
  return withoutTrailing === "/" ? "" : withoutTrailing;
}

function withBase(path: string): string {
  if (!DASHBOARD_BASE_PATH) return path;
  if (path === "/") return `${DASHBOARD_BASE_PATH}/`;
  return `${DASHBOARD_BASE_PATH}${path}`;
}

function stripBasePath(path: string): string {
  if (!DASHBOARD_BASE_PATH) return path;
  if (!path.startsWith(DASHBOARD_BASE_PATH)) return path;
  const stripped = path.slice(DASHBOARD_BASE_PATH.length);
  return stripped || "/";
}

function readDaemonState(): DaemonState | null {
  if (!existsSync(DAEMON_STATE_PATH)) return null;
  try {
    const state = JSON.parse(readFileSync(DAEMON_STATE_PATH, "utf-8")) as DaemonState;
    if (!state?.port || state.port <= 0) return null;
    return state;
  } catch {
    return null;
  }
}

function daemonBaseUrl(): string | null {
  const state = readDaemonState();
  if (!state) return null;
  return `http://127.0.0.1:${state.port}`;
}

function resolveDaemonProxyPath(pathname: string): string {
  const prefix = withBase("/api/daemon");
  if (pathname.startsWith(prefix)) {
    const tail = pathname.slice(prefix.length);
    return tail || "/";
  }
  return pathname.replace(/^\/api\/daemon/, "") || "/";
}

if (DASHBOARD_BASE_PATH) {
  app.get("/", (c) => c.redirect(`${DASHBOARD_BASE_PATH}/`, 307));
  app.get(DASHBOARD_BASE_PATH, (c) => c.redirect(`${DASHBOARD_BASE_PATH}/`, 307));
}

app.get(withBase("/api/daemon/state"), (c) => {
  const state = readDaemonState();
  if (!state) return c.json({ online: false, error: "daemon 未运行或状态文件不可读" }, 503);
  return c.json({ online: true, basePath: DASHBOARD_BASE_PATH || "/", state });
});

app.all(withBase("/api/daemon/*"), async (c) => {
  const base = daemonBaseUrl();
  if (!base) {
    return c.json({ error: "daemon 未运行" }, 503);
  }

  const reqUrl = new URL(c.req.url);
  const path = resolveDaemonProxyPath(c.req.path);
  const targetUrl = `${base}${path}${reqUrl.search}`;
  const method = c.req.method.toUpperCase();
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await c.req.arrayBuffer();
  }

  try {
    const resp = await fetch(targetUrl, init);
    const proxyHeaders = new Headers(resp.headers);
    proxyHeaders.set("x-yuanio-daemon", base);
    return new Response(resp.body, { status: resp.status, headers: proxyHeaders });
  } catch (err: any) {
    return c.json({ error: err?.message || "daemon 请求失败", targetUrl }, 502);
  }
});

app.use(
  withBase("/*"),
  serveStatic({
    root: "./public",
    rewriteRequestPath: (path) => stripBasePath(path),
  }),
);

export default { port: PORT, fetch: app.fetch };
const displayBase = DASHBOARD_BASE_PATH ? `${DASHBOARD_BASE_PATH}/` : "/";
console.log(`Dashboard running on http://localhost:${PORT}${displayBase}`);

use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use crate::{
    app_core::AppState,
    daemon_state::read_state,
    keystore::load_keys,
    resolve_bun_cmd,
    resolve_cli_entry,
    resolve_repo_root,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub public_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub relay: ServiceInfo,
    pub daemon: ServiceInfo,
    pub tunnel: ServiceInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflaredServiceState {
    pub supported: bool,
    pub status: CloudflaredStatus,
    pub installed: bool,
    pub running: bool,
    pub checking: bool,
    pub installing: bool,
    pub bin_path: Option<String>,
    pub last_backup_dir: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudflaredStatus {
    Unknown,
    Checking,
    Ready,
    Missing,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceProfile {
    Lan,
    Tunnel,
    Idle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSnapshot {
    pub service: ServiceState,
    pub cloudflared: CloudflaredServiceState,
    pub profile: ServiceProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStartPayload {
    pub profile: ServiceProfile,
    pub server_url: Option<String>,
    pub relay_port: Option<u16>,
    pub tunnel_mode: Option<String>,
    pub tunnel_name: Option<String>,
    pub tunnel_hostname: Option<String>,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStartPayload {
    pub relay_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStartPayload {
    pub relay_port: Option<u16>,
    pub tunnel_mode: Option<String>,
    pub tunnel_name: Option<String>,
    pub tunnel_hostname: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStartPayload {
    pub server_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStartPayload {
    pub server_url: Option<String>,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflaredInstallPayload {
    pub tunnel_name: Option<String>,
    pub relay_port: Option<u16>,
}

pub struct ServiceManager {
    service: ServiceState,
    cloudflared: CloudflaredServiceState,
    relay_proc: Option<Child>,
    tunnel_proc: Option<Child>,
    remote_bridge_proc: Option<Child>,
}

impl ServiceManager {
    pub fn new() -> Self {
        let relay_port = 3000;
        Self {
            service: ServiceState {
                relay: ServiceInfo {
                    status: ServiceStatus::Stopped,
                    pid: None,
                    port: Some(relay_port),
                    url: Some(relay_url_for(relay_port)),
                    public_url: None,
                },
                daemon: ServiceInfo {
                    status: ServiceStatus::Stopped,
                    pid: None,
                    port: None,
                    url: None,
                    public_url: None,
                },
                tunnel: ServiceInfo {
                    status: ServiceStatus::Stopped,
                    pid: None,
                    port: None,
                    url: None,
                    public_url: None,
                },
            },
            cloudflared: initial_cloudflared_state(),
            relay_proc: None,
            tunnel_proc: None,
            remote_bridge_proc: None,
        }
    }

    pub fn snapshot(&mut self) -> ServiceSnapshot {
        self.refresh_processes();
        self.refresh_daemon();
        ServiceSnapshot {
            service: self.service.clone(),
            cloudflared: self.cloudflared.clone(),
            profile: derive_profile(&self.service),
        }
    }

    pub fn start_profile(
        &mut self,
        manager_handle: Arc<Mutex<ServiceManager>>,
        payload: ServiceStartPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        let relay_port = payload.relay_port.unwrap_or(3000);
        let relay_url = relay_url_for(relay_port);
        let server_url = payload
            .server_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| relay_url.clone());
        let tunnel_mode = payload
            .tunnel_mode
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "quick".to_string());
        let tunnel_name = payload.tunnel_name.unwrap_or_default();
        let tunnel_hostname = payload.tunnel_hostname.unwrap_or_default();
        let namespace = payload.namespace.or_else(|| load_keys().ok().flatten().map(|s| s.keys.namespace));

        self.service.relay.port = Some(relay_port);
        self.service.relay.url = Some(relay_url.clone());

        match payload.profile {
            ServiceProfile::Lan => {
                self.stop_tunnel(&app_state);
                self.start_relay(&relay_url, relay_port, app_state.clone())?;
                self.start_daemon(&relay_url, app_state.clone())?;
                self.start_remote_bridge(&server_url, &relay_url, namespace, app_state.clone())?;
            }
            ServiceProfile::Tunnel => {
                self.start_relay(&relay_url, relay_port, app_state.clone())?;
                self.start_tunnel(
                    manager_handle.clone(),
                    &relay_url,
                    &tunnel_mode,
                    &tunnel_name,
                    &tunnel_hostname,
                    app_state.clone(),
                )?;
                self.start_daemon(&relay_url, app_state.clone())?;
                self.start_remote_bridge(&server_url, &relay_url, namespace, app_state.clone())?;
            }
            ServiceProfile::Idle => {
                self.stop_all(&app_state)?;
            }
        }

        Ok(self.snapshot())
    }

    pub fn start_relay_only(
        &mut self,
        payload: RelayStartPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        let relay_port = payload.relay_port.unwrap_or(3000);
        let relay_url = relay_url_for(relay_port);
        self.start_relay(&relay_url, relay_port, app_state)?;
        Ok(self.snapshot())
    }

    pub fn stop_relay_only(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<ServiceSnapshot, String> {
        self.stop_relay(app_state);
        Ok(self.snapshot())
    }

    pub fn start_tunnel_only(
        &mut self,
        manager_handle: Arc<Mutex<ServiceManager>>,
        payload: TunnelStartPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        let relay_port = payload
            .relay_port
            .or(self.service.relay.port)
            .unwrap_or(3000);
        let relay_url = relay_url_for(relay_port);
        self.service.relay.port = Some(relay_port);
        self.service.relay.url = Some(relay_url.clone());

        if !matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting) {
            self.start_relay(&relay_url, relay_port, app_state.clone())?;
        }

        let tunnel_mode = payload
            .tunnel_mode
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "quick".to_string());
        let tunnel_name = payload.tunnel_name.unwrap_or_default();
        let tunnel_hostname = payload.tunnel_hostname.unwrap_or_default();

        self.start_tunnel(
            manager_handle,
            &relay_url,
            &tunnel_mode,
            &tunnel_name,
            &tunnel_hostname,
            app_state,
        )?;
        Ok(self.snapshot())
    }

    pub fn stop_tunnel_only(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<ServiceSnapshot, String> {
        self.stop_tunnel(app_state);
        Ok(self.snapshot())
    }

    pub fn start_daemon_only(
        &mut self,
        payload: DaemonStartPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        let relay_url = self
            .service
            .relay
            .url
            .clone()
            .unwrap_or_else(|| relay_url_for(self.service.relay.port.unwrap_or(3000)));
        let server_url = payload
            .server_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| relay_url.clone());
        let target = if matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting) {
            relay_url
        } else {
            server_url
        };
        self.start_daemon(&target, app_state)?;
        Ok(self.snapshot())
    }

    pub fn stop_daemon_only(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<ServiceSnapshot, String> {
        self.stop_daemon(app_state)?;
        Ok(self.snapshot())
    }

    pub fn start_bridge_only(
        &mut self,
        payload: BridgeStartPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        let relay_url = self
            .service
            .relay
            .url
            .clone()
            .unwrap_or_else(|| relay_url_for(self.service.relay.port.unwrap_or(3000)));
        let server_url = payload
            .server_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| relay_url.clone());
        let namespace = payload.namespace.or_else(|| load_keys().ok().flatten().map(|s| s.keys.namespace));
        self.start_remote_bridge(&server_url, &relay_url, namespace, app_state)?;
        Ok(self.snapshot())
    }

    pub fn stop_bridge_only(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<ServiceSnapshot, String> {
        self.stop_remote_bridge(app_state);
        Ok(self.snapshot())
    }

    pub fn stop_all(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<ServiceSnapshot, String> {
        self.stop_remote_bridge(app_state);
        self.stop_daemon(app_state)?;
        self.stop_tunnel(app_state);
        self.stop_relay(app_state);
        Ok(self.snapshot())
    }

    pub fn reload_remote_bridge(
        &mut self,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<ServiceSnapshot, String> {
        self.stop_remote_bridge(&app_state);
        let relay_url = self
            .service
            .relay
            .url
            .clone()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        let server_url = relay_url.clone();
        let namespace = load_keys().ok().flatten().map(|s| s.keys.namespace);
        self.start_remote_bridge(&server_url, &relay_url, namespace, app_state)?;
        Ok(self.snapshot())
    }

    pub fn refresh_cloudflared(&mut self, app_state: Arc<Mutex<AppState>>) -> CloudflaredServiceState {
        self.cloudflared = query_cloudflared_service(app_state);
        self.cloudflared.clone()
    }

    pub fn install_cloudflared(
        &mut self,
        payload: CloudflaredInstallPayload,
        app_state: Arc<Mutex<AppState>>,
    ) -> CloudflaredServiceState {
        self.cloudflared = install_cloudflared_service(payload, app_state);
        self.cloudflared.clone()
    }

    fn refresh_processes(&mut self) {
        refresh_child_process(&mut self.relay_proc, &mut self.service.relay);
        refresh_child_process(&mut self.tunnel_proc, &mut self.service.tunnel);
        refresh_child_handle(&mut self.remote_bridge_proc);
    }

    fn refresh_daemon(&mut self) {
        match read_state() {
            Some(state) => {
                self.service.daemon.status = ServiceStatus::Running;
                self.service.daemon.pid = Some(state.pid);
                self.service.daemon.port = Some(state.port);
                self.service.daemon.url = None;
                self.service.daemon.public_url = None;
            }
            None => {
                self.service.daemon.status = ServiceStatus::Stopped;
                self.service.daemon.pid = None;
                self.service.daemon.port = None;
            }
        }
    }

    fn start_relay(
        &mut self,
        relay_url: &str,
        relay_port: u16,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<(), String> {
        if matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting) {
            return Ok(());
        }

        self.service.relay.status = ServiceStatus::Starting;
        self.service.relay.port = Some(relay_port);
        self.service.relay.url = Some(relay_url.to_string());
        append_log(&app_state, format!("准备启动 relay: {relay_url}"));

        let relay_entry = resolve_repo_root()
            .join("packages")
            .join("relay-server")
            .join("src")
            .join("index.ts");
        let bun_cmd = resolve_bun_cmd();

        let mut child = Command::new(bun_cmd)
            .arg("run")
            .arg(relay_entry)
            .env("PORT", relay_port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                self.service.relay.status = ServiceStatus::Error;
                format!("启动 relay 失败: {e}")
            })?;

        self.service.relay.pid = Some(child.id());
        spawn_reader(child.stdout.take(), app_state.clone(), "relay");
        spawn_reader(child.stderr.take(), app_state.clone(), "relay");
        self.relay_proc = Some(child);

        if wait_for_health(&format!("{relay_url}/health"), Duration::from_secs(8)) {
            self.service.relay.status = ServiceStatus::Running;
            append_log(&app_state, "relay 已就绪".to_string());
            return Ok(());
        }

        self.service.relay.status = ServiceStatus::Error;
        append_log(&app_state, "relay 启动超时".to_string());
        Ok(())
    }

    fn stop_relay(&mut self, app_state: &Arc<Mutex<AppState>>) {
        if let Some(mut child) = self.relay_proc.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.service.relay.status = ServiceStatus::Stopped;
        self.service.relay.pid = None;
        append_log(app_state, "已停止 relay".to_string());
    }

    fn start_daemon(&mut self, server_url: &str, app_state: Arc<Mutex<AppState>>) -> Result<(), String> {
        append_log(&app_state, format!("准备启动 daemon: {server_url}"));
        let status = crate::daemon_start(server_url.to_string())?;
        if status.running {
            self.service.daemon.status = ServiceStatus::Running;
            self.service.daemon.pid = status.pid;
            self.service.daemon.port = status.port;
            append_log(&app_state, "daemon 已启动".to_string());
        } else {
            self.service.daemon.status = ServiceStatus::Error;
        }
        Ok(())
    }

    fn stop_daemon(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<(), String> {
        if let Err(err) = crate::daemon_stop() {
            append_log(app_state, format!("停止 daemon 失败: {err}"));
        }
        self.service.daemon.status = ServiceStatus::Stopped;
        self.service.daemon.pid = None;
        self.service.daemon.port = None;
        append_log(app_state, "已停止 daemon".to_string());
        Ok(())
    }

    fn start_tunnel(
        &mut self,
        manager_handle: Arc<Mutex<ServiceManager>>,
        relay_url: &str,
        tunnel_mode: &str,
        tunnel_name: &str,
        tunnel_hostname: &str,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<(), String> {
        if matches!(self.service.tunnel.status, ServiceStatus::Running | ServiceStatus::Starting) {
            return Ok(());
        }

        let cloudflared_path = resolve_command("cloudflared");
        if cloudflared_path.is_none() {
            self.service.tunnel.status = ServiceStatus::Error;
            append_log(&app_state, "未找到 cloudflared，无法启动 Tunnel".to_string());
            return Ok(());
        }

        self.service.tunnel.status = ServiceStatus::Starting;
        self.service.tunnel.pid = None;
        self.service.tunnel.public_url = None;

        let is_named = tunnel_mode == "named" && !tunnel_name.is_empty();
        let mut args: Vec<String> = Vec::new();
        if is_named {
            args.extend(["tunnel".to_string(), "run".to_string(), tunnel_name.to_string()]);
            append_log(&app_state, format!("启动命名 Tunnel: {tunnel_name}"));
        } else {
            args.extend([
                "tunnel".to_string(),
                "--url".to_string(),
                relay_url.to_string(),
            ]);
            append_log(&app_state, "启动 quick Tunnel".to_string());
        }

        let mut child = Command::new(cloudflared_path.unwrap())
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                self.service.tunnel.status = ServiceStatus::Error;
                format!("启动 Tunnel 失败: {e}")
            })?;

        self.service.tunnel.pid = Some(child.id());
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        self.tunnel_proc = Some(child);

        spawn_reader(stdout, app_state.clone(), "tunnel");
        spawn_tunnel_reader(stderr, manager_handle, app_state.clone(), tunnel_hostname.to_string());

        if is_named && !tunnel_hostname.is_empty() {
            let public_url = format!("https://{tunnel_hostname}");
            self.service.tunnel.public_url = Some(public_url.clone());
            if wait_for_health(&format!("{public_url}/health"), Duration::from_secs(60)) {
                self.service.tunnel.status = ServiceStatus::Running;
            } else {
                self.service.tunnel.status = ServiceStatus::Error;
            }
        }

        Ok(())
    }

    fn stop_tunnel(&mut self, app_state: &Arc<Mutex<AppState>>) {
        if let Some(mut child) = self.tunnel_proc.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.service.tunnel.status = ServiceStatus::Stopped;
        self.service.tunnel.pid = None;
        self.service.tunnel.public_url = None;
        append_log(app_state, "已停止 Tunnel".to_string());
    }

    fn start_remote_bridge(
        &mut self,
        server_url: &str,
        relay_url: &str,
        namespace: Option<String>,
        app_state: Arc<Mutex<AppState>>,
    ) -> Result<(), String> {
        if self.remote_bridge_proc.is_some() {
            return Ok(());
        }
        if load_keys().ok().flatten().is_none() {
            append_log(&app_state, "尚未配对，跳过远程桥接".to_string());
            return Ok(());
        }
        let target_url = if matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting) {
            relay_url
        } else {
            server_url
        };

        append_log(&app_state, format!("准备启动远程桥接: {target_url}"));

        let bun_cmd = resolve_bun_cmd();
        let cli_entry = resolve_cli_entry();
        let mut cmd = Command::new(bun_cmd);
        cmd.arg("run")
            .arg(cli_entry)
            .arg("--server")
            .arg(target_url)
            .arg("--continue");
        if let Some(ns) = namespace {
            cmd.arg("--namespace").arg(ns);
        }
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动远程桥接失败: {e}"))?;

        spawn_reader(child.stdout.take(), app_state.clone(), "bridge");
        spawn_reader(child.stderr.take(), app_state.clone(), "bridge");
        self.remote_bridge_proc = Some(child);
        Ok(())
    }

    fn stop_remote_bridge(&mut self, app_state: &Arc<Mutex<AppState>>) {
        if let Some(mut child) = self.remote_bridge_proc.take() {
            let _ = child.kill();
            let _ = child.wait();
            append_log(app_state, "已停止远程桥接".to_string());
        }
    }
}

fn relay_url_for(port: u16) -> String {
    format!("http://localhost:{port}")
}

fn append_log(state: &Arc<Mutex<AppState>>, text: String) {
    if let Ok(mut guard) = state.lock() {
        guard.push_log(text);
    }
}

fn refresh_child_process(proc: &mut Option<Child>, info: &mut ServiceInfo) {
    if let Some(child) = proc.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                info.status = ServiceStatus::Stopped;
                info.pid = None;
                info.public_url = None;
                *proc = None;
            }
            Ok(None) => {}
            Err(_) => {
                info.status = ServiceStatus::Error;
            }
        }
    }
}

fn refresh_child_handle(proc: &mut Option<Child>) {
    if let Some(child) = proc.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                *proc = None;
            }
            Ok(None) => {}
            Err(_) => {}
        }
    }
}

fn derive_profile(state: &ServiceState) -> ServiceProfile {
    let relay_ok = matches!(state.relay.status, ServiceStatus::Running);
    let daemon_ok = matches!(state.daemon.status, ServiceStatus::Running);
    let tunnel_ok = matches!(state.tunnel.status, ServiceStatus::Running);
    if relay_ok && daemon_ok && !tunnel_ok {
        return ServiceProfile::Lan;
    }
    if relay_ok && daemon_ok && tunnel_ok {
        return ServiceProfile::Tunnel;
    }
    ServiceProfile::Idle
}

fn wait_for_health(url: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    while Instant::now() < deadline {
        if let Ok(resp) = client.get(url).send() {
            if resp.status().is_success() {
                return true;
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn resolve_command(name: &str) -> Option<String> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(cmd).arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next().map(|line| line.trim().to_string()).filter(|s| !s.is_empty())
}

fn spawn_reader(stream: Option<impl std::io::Read + Send + 'static>, app_state: Arc<Mutex<AppState>>, label: &'static str) {
    if let Some(stream) = stream {
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().flatten() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                append_log(&app_state, format!("[{label}] {trimmed}"));
            }
        });
    }
}

fn spawn_tunnel_reader(
    stream: Option<impl std::io::Read + Send + 'static>,
    manager_handle: Arc<Mutex<ServiceManager>>,
    app_state: Arc<Mutex<AppState>>,
    tunnel_hostname: String,
) {
    if let Some(stream) = stream {
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().flatten() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                append_log(&app_state, format!("[tunnel] {trimmed}"));

                if let Some(url) = extract_trycloudflare_url(trimmed) {
                    if let Ok(mut manager) = manager_handle.lock() {
                        manager.service.tunnel.public_url = Some(url.clone());
                        let ok = wait_for_health(&format!("{url}/health"), Duration::from_secs(60));
                        manager.service.tunnel.status = if ok { ServiceStatus::Running } else { ServiceStatus::Error };
                    }
                }

                if !tunnel_hostname.is_empty() && trimmed.contains("Registered tunnel connection") {
                    let url = format!("https://{tunnel_hostname}");
                    if let Ok(mut manager) = manager_handle.lock() {
                        manager.service.tunnel.public_url = Some(url.clone());
                        let ok = wait_for_health(&format!("{url}/health"), Duration::from_secs(60));
                        manager.service.tunnel.status = if ok { ServiceStatus::Running } else { ServiceStatus::Error };
                    }
                }
            }
        });
    }
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    let marker = "https://";
    let start = line.find(marker)?;
    let rest = &line[start..];
    let end = rest.find(' ').unwrap_or(rest.len());
    let candidate = &rest[..end];
    if candidate.contains("trycloudflare.com") {
        return Some(candidate.trim().to_string());
    }
    None
}

fn initial_cloudflared_state() -> CloudflaredServiceState {
    if cfg!(windows) {
        CloudflaredServiceState {
            supported: true,
            status: CloudflaredStatus::Unknown,
            installed: false,
            running: false,
            checking: false,
            installing: false,
            bin_path: None,
            last_backup_dir: None,
            detail: Some("未检测".to_string()),
        }
    } else {
        CloudflaredServiceState {
            supported: false,
            status: CloudflaredStatus::Ready,
            installed: false,
            running: false,
            checking: false,
            installing: false,
            bin_path: None,
            last_backup_dir: None,
            detail: Some("仅 Windows 支持服务管理".to_string()),
        }
    }
}

fn query_cloudflared_service(app_state: Arc<Mutex<AppState>>) -> CloudflaredServiceState {
    if !cfg!(windows) {
        return initial_cloudflared_state();
    }

    append_log(&app_state, "检查 cloudflared 服务状态".to_string());
    let query = Command::new("sc.exe").arg("query").arg("cloudflared").output();
    let query_output = query.ok().map(|o| String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr));
    let missing = match &query_output {
        Some(text) => text.contains("1060") || text.contains("does not exist"),
        None => true,
    };
    if missing {
        return CloudflaredServiceState {
            supported: true,
            status: CloudflaredStatus::Missing,
            installed: false,
            running: false,
            checking: false,
            installing: false,
            bin_path: None,
            last_backup_dir: None,
            detail: Some("未安装".to_string()),
        };
    }

    let qc = Command::new("sc.exe").arg("qc").arg("cloudflared").output().ok();
    let qc_text = qc.as_ref().map(|o| String::from_utf8_lossy(&o.stdout).to_string());
    let bin_path = qc_text.as_ref().and_then(|text| extract_service_bin_path(text));
    let running = query_output.as_ref().map(|text| text.contains("RUNNING")).unwrap_or(false);

    CloudflaredServiceState {
        supported: true,
        status: CloudflaredStatus::Ready,
        installed: true,
        running,
        checking: false,
        installing: false,
        bin_path,
        last_backup_dir: None,
        detail: Some(if running { "运行中" } else { "已安装" }.to_string()),
    }
}

fn install_cloudflared_service(
    payload: CloudflaredInstallPayload,
    app_state: Arc<Mutex<AppState>>,
) -> CloudflaredServiceState {
    if !cfg!(windows) {
        return initial_cloudflared_state();
    }

    let tunnel_name = payload.tunnel_name.unwrap_or_default();
    let relay_port = payload.relay_port.unwrap_or(3000);

    if tunnel_name.trim().is_empty() {
        append_log(&app_state, "Tunnel 名称为空，无法安装 Cloudflared 服务".to_string());
        return CloudflaredServiceState {
            supported: true,
            status: CloudflaredStatus::Error,
            installed: false,
            running: false,
            checking: false,
            installing: false,
            bin_path: None,
            last_backup_dir: None,
            detail: Some("Tunnel 名称为空".to_string()),
        };
    }

    let script_path = resolve_repo_root()
        .join("scripts")
        .join("install-cloudflared-service.ps1");
    append_log(&app_state, format!("执行安装脚本: {}", script_path.display()));

    let pwsh = resolve_command("pwsh").or_else(|| resolve_command("powershell"));
    if pwsh.is_none() {
        append_log(&app_state, "未找到 PowerShell".to_string());
        return CloudflaredServiceState {
            supported: true,
            status: CloudflaredStatus::Error,
            installed: false,
            running: false,
            checking: false,
            installing: false,
            bin_path: None,
            last_backup_dir: None,
            detail: Some("缺少 PowerShell".to_string()),
        };
    }

    let runner = pwsh.unwrap();
    let mut cmd = Command::new(runner);
    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script_path)
        .arg("-TunnelName")
        .arg(tunnel_name)
        .arg("-RelayPort")
        .arg(relay_port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            append_log(&app_state, format!("安装失败: {err}"));
            return CloudflaredServiceState {
                supported: true,
                status: CloudflaredStatus::Error,
                installed: false,
                running: false,
                checking: false,
                installing: false,
                bin_path: None,
                last_backup_dir: None,
                detail: Some("安装失败".to_string()),
            };
        }
    };

    let backup_dir: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    if let Some(stdout) = child.stdout.take() {
        let state = app_state.clone();
        let backup_clone = backup_dir.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Some(dir) = extract_backup_dir(&line) {
                    if let Ok(mut guard) = backup_clone.lock() {
                        *guard = Some(dir);
                    }
                }
                append_log(&state, format!("[cloudflared] {}", line.trim()));
            }
        });
    }
    spawn_reader(child.stderr.take(), app_state.clone(), "cloudflared");

    let _ = child.wait();
    let mut next = query_cloudflared_service(app_state);
    if let Ok(guard) = backup_dir.lock() {
        if let Some(dir) = guard.clone() {
            next.last_backup_dir = Some(dir);
        }
    }
    next
}

fn extract_service_bin_path(text: &str) -> Option<String> {
    let marker = "BINARY_PATH_NAME";
    let line = text.lines().find(|line| line.contains(marker))?;
    line.split(':').nth(1).map(|s| s.trim().to_string())
}

fn extract_backup_dir(text: &str) -> Option<String> {
    let marker = "备份目录:";
    let pos = text.find(marker)?;
    Some(text[(pos + marker.len())..].trim().to_string())
}

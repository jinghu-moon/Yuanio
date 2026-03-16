use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader},
    net::TcpStream,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{connect, Message};

use crate::{
    app_core::AppState,
    daemon::{DaemonServer, DaemonServerHandle},
    daemon_state::{read_state, DaemonState},
    keystore::load_keys,
    relay::{
        config::RelayConfig,
        protocol::{should_queue_ack_by_type, AckMessage, AckState, Envelope, WsFrame},
        server::{RelayServer, RelayServerHandle},
    },
    remote_bridge::{build_hello_frame, build_ws_url, normalize_envelope_payload, HelloOptions},
    resolve_repo_root,
    ws_client::{CoreConfig, RelayWsClientCore, SendOutcome},
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

struct RemoteBridgeConfig {
    server_url: String,
    session_token: String,
    session_id: String,
    device_id: String,
}

struct RemoteBridgeHandle {
    shutdown_tx: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
}

impl RemoteBridgeHandle {
    fn stop(self) {
        let _ = self.shutdown_tx.send(());
        let _ = self.join.join();
    }
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
    relay_handle: Option<RelayServerHandle>,
    daemon_handle: Option<DaemonServerHandle>,
    tunnel_proc: Option<Child>,
    remote_bridge_handle: Option<RemoteBridgeHandle>,
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
            relay_handle: None,
            daemon_handle: None,
            tunnel_proc: None,
            remote_bridge_handle: None,
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
        if self.relay_handle.is_none()
            && matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting)
        {
            self.service.relay.status = ServiceStatus::Stopped;
            self.service.relay.pid = None;
        }
        refresh_child_process(&mut self.tunnel_proc, &mut self.service.tunnel);
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
        if self.relay_handle.is_some() {
            return Ok(());
        }

        self.service.relay.status = ServiceStatus::Starting;
        self.service.relay.port = Some(relay_port);
        self.service.relay.url = Some(relay_url.to_string());
        append_log(&app_state, format!("准备启动 relay: {relay_url}"));

        let mut config = RelayConfig::from_env().map_err(|e| {
            self.service.relay.status = ServiceStatus::Error;
            format!("启动 relay 失败: {e}")
        })?;
        config.port = relay_port;

        let handle = RelayServer::spawn(config).map_err(|e| {
            self.service.relay.status = ServiceStatus::Error;
            format!("启动 relay 失败: {e}")
        })?;
        self.relay_handle = Some(handle);

        if wait_for_health(&format!("{relay_url}/health"), Duration::from_secs(8)) {
            self.service.relay.status = ServiceStatus::Running;
            append_log(&app_state, "relay 已就绪".to_string());
            return Ok(());
        }

        self.service.relay.status = ServiceStatus::Error;
        if let Some(handle) = self.relay_handle.take() {
            handle.stop();
        }
        append_log(&app_state, "relay 启动超时".to_string());
        Ok(())
    }

    fn stop_relay(&mut self, app_state: &Arc<Mutex<AppState>>) {
        if let Some(handle) = self.relay_handle.take() {
            handle.stop();
        }
        self.service.relay.status = ServiceStatus::Stopped;
        self.service.relay.pid = None;
        append_log(app_state, "已停止 relay".to_string());
    }

    fn start_daemon(&mut self, server_url: &str, app_state: Arc<Mutex<AppState>>) -> Result<(), String> {
        if matches!(self.service.daemon.status, ServiceStatus::Running | ServiceStatus::Starting) {
            return Ok(());
        }
        append_log(&app_state, format!("准备启动 daemon: {server_url}"));
        self.service.daemon.status = ServiceStatus::Starting;
        self.service.daemon.pid = None;
        self.service.daemon.port = None;

        let handle = DaemonServer::spawn().map_err(|e| {
            self.service.daemon.status = ServiceStatus::Error;
            format!("启动 daemon 失败: {e}")
        })?;
        let daemon_port = handle.port;
        self.service.daemon.port = Some(daemon_port);

        let state = wait_for_daemon_state(6, Duration::from_millis(200));
        match state {
            Some(state) => {
                self.daemon_handle = Some(handle);
                self.service.daemon.status = ServiceStatus::Running;
                self.service.daemon.pid = Some(state.pid);
                self.service.daemon.port = Some(state.port);
                append_log(&app_state, "daemon 已启动".to_string());
            }
            None => {
                handle.stop();
                self.service.daemon.status = ServiceStatus::Error;
                self.service.daemon.port = None;
                append_log(&app_state, "daemon 启动失败：状态未落盘，已停止".to_string());
            }
        }
        Ok(())
    }

    fn stop_daemon(&mut self, app_state: &Arc<Mutex<AppState>>) -> Result<(), String> {
        if let Some(handle) = self.daemon_handle.take() {
            handle.stop();
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
        if self.remote_bridge_handle.is_some() {
            return Ok(());
        }
        let session = match load_keys().ok().flatten() {
            Some(value) => value,
            None => {
                append_log(&app_state, "尚未配对，跳过远程桥接".to_string());
                return Ok(());
            }
        };
        let target_url = if matches!(self.service.relay.status, ServiceStatus::Running | ServiceStatus::Starting) {
            relay_url
        } else {
            server_url
        };

        append_log(&app_state, format!("准备启动远程桥接: {target_url}"));

        let config = RemoteBridgeConfig {
            server_url: target_url.to_string(),
            session_token: session.keys.session_token.clone(),
            session_id: session.keys.session_id.clone(),
            device_id: session.keys.device_id.clone(),
        };
        let handle = spawn_remote_bridge(config, namespace, app_state.clone())?;
        self.remote_bridge_handle = Some(handle);
        Ok(())
    }

    fn stop_remote_bridge(&mut self, app_state: &Arc<Mutex<AppState>>) {
        if let Some(handle) = self.remote_bridge_handle.take() {
            handle.stop();
            append_log(app_state, "已停止远程桥接".to_string());
        }
    }
}

fn spawn_remote_bridge(
    config: RemoteBridgeConfig,
    namespace: Option<String>,
    app_state: Arc<Mutex<AppState>>,
) -> Result<RemoteBridgeHandle, String> {
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let join = thread::spawn(move || {
        remote_bridge_loop(config, namespace, app_state, shutdown_rx);
    });
    Ok(RemoteBridgeHandle { shutdown_tx, join })
}

fn remote_bridge_loop(
    config: RemoteBridgeConfig,
    namespace: Option<String>,
    app_state: Arc<Mutex<AppState>>,
    shutdown_rx: mpsc::Receiver<()>,
) {
    let mut core = RelayWsClientCore::new(CoreConfig {
        ack_timeout_ms: 5_000,
        ack_max_retries: 3,
        offline_queue_max: 500,
    });
    let reconnect_delay = Duration::from_millis(800);
    let read_timeout = Duration::from_millis(500);

    loop {
        if shutdown_rx.try_recv().is_ok() {
            break;
        }

        let ws_url = match build_ws_url(&config.server_url) {
            Ok(url) => url,
            Err(err) => {
                append_log(&app_state, format!("远程桥接地址错误: {err}"));
                if wait_for_shutdown(&shutdown_rx, reconnect_delay) {
                    break;
                }
                continue;
            }
        };

        let connect_result = connect(ws_url.as_str());
        let Ok((mut socket, _)) = connect_result else {
            append_log(&app_state, "远程桥接连接失败".to_string());
            if wait_for_shutdown(&shutdown_rx, reconnect_delay) {
                break;
            }
            continue;
        };
        set_ws_read_timeout(&mut socket, read_timeout);
        append_log(&app_state, "远程桥接已连接".to_string());

        let hello = build_hello_frame(
            &config.session_token,
            HelloOptions {
                protocol_version: None,
                namespace: namespace.clone(),
                device_id: None,
                role: None,
                client_version: None,
                capabilities: None,
            },
        );
        let _ = send_ws_frame(&mut socket, &hello);

        let queued = core.set_connected(true);
        for payload in queued {
            let _ = socket.send(Message::Text(payload));
        }

        loop {
            if shutdown_rx.try_recv().is_ok() {
                let _ = socket.close(None);
                return;
            }

            let now = now_ms();
            let resend = core.tick(now);
            for payload in resend {
                if socket.send(Message::Text(payload.clone())).is_ok() {
                    if let Ok(WsFrame::Ack(ack)) = serde_json::from_str::<WsFrame>(&payload) {
                        core.handle_ack(&ack.message_id, "ok");
                    }
                }
            }

            match socket.read() {
                Ok(msg) => handle_remote_bridge_message(&mut socket, &mut core, &config, &app_state, msg),
                Err(tungstenite::Error::Io(err))
                    if matches!(err.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) =>
                {
                    continue;
                }
                Err(err) => {
                    append_log(&app_state, format!("远程桥接连接中断: {err}"));
                    break;
                }
            }
        }

        core.set_connected(false);
        if wait_for_shutdown(&shutdown_rx, reconnect_delay) {
            break;
        }
    }
}

fn handle_remote_bridge_message(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    core: &mut RelayWsClientCore,
    config: &RemoteBridgeConfig,
    app_state: &Arc<Mutex<AppState>>,
    msg: Message,
) {
    let text = match msg {
        Message::Text(value) => value,
        Message::Binary(value) => String::from_utf8_lossy(&value).to_string(),
        _ => return,
    };
    let frame = match serde_json::from_str::<WsFrame>(&text) {
        Ok(frame) => frame,
        Err(err) => {
            append_log(app_state, format!("远程桥接收到非法帧: {err}"));
            return;
        }
    };

    match frame {
        WsFrame::Message(envelope) => {
            if let Err(err) = normalize_envelope_payload(&envelope.payload) {
                append_log(app_state, format!("远程桥接收到非法 payload: {err}"));
                return;
            }

            let message_id = envelope.id.clone();
            let kind = envelope.kind.clone();
            if !queue_inbound_message(app_state, envelope) {
                append_log(app_state, "远程桥接入站队列写入失败".to_string());
                return;
            }

            if should_queue_ack_by_type(&kind) {
                let ack = AckMessage {
                    message_id: message_id.clone(),
                    source: config.device_id.clone(),
                    session_id: config.session_id.clone(),
                    state: Some(AckState::Ok),
                    retry_after_ms: None,
                    reason: None,
                    at: Some(now_ms_i64()),
                };
                if let Ok(payload) = serde_json::to_string(&WsFrame::Ack(ack)) {
                    core.track_reliable(message_id.clone(), payload.clone(), now_ms());
                    if send_or_queue(core, socket, payload, app_state) {
                        core.handle_ack(&message_id, "ok");
                    }
                }
            }
        }
        WsFrame::Ack(ack) => {
            let state = match ack.state {
                Some(AckState::RetryAfter) => "retry_after",
                Some(AckState::Working) => "working",
                Some(AckState::Terminal) => "terminal",
                _ => "ok",
            };
            core.handle_ack(&ack.message_id, state);
        }
        WsFrame::Presence(_) => {}
        WsFrame::Hello(_) => {}
        WsFrame::Error(err) => {
            append_log(app_state, format!("远程桥接错误: {}", err.message));
        }
    }
}

fn send_or_queue(
    core: &mut RelayWsClientCore,
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    payload: String,
    app_state: &Arc<Mutex<AppState>>,
) -> bool {
    match core.enqueue_or_send(payload.clone()) {
        SendOutcome::Sent => {
            return socket.send(Message::Text(payload)).is_ok();
        }
        SendOutcome::Queued => {
            append_log(app_state, "远程桥接离线缓存消息".to_string());
        }
        SendOutcome::Dropped => {
            append_log(app_state, "远程桥接离线队列已满，丢弃消息".to_string());
        }
    }
    false
}

fn send_ws_frame(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    frame: &WsFrame,
) -> Result<(), String> {
    let payload = serde_json::to_string(frame).map_err(|e| format!("序列化帧失败: {e}"))?;
    socket.send(Message::Text(payload)).map_err(|e| format!("发送帧失败: {e}"))
}

fn set_ws_read_timeout(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    timeout: Duration,
) {
    use tungstenite::stream::MaybeTlsStream;
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            let _ = stream.set_read_timeout(Some(timeout));
        }
        MaybeTlsStream::Rustls(stream) => {
            let _ = stream.get_ref().set_read_timeout(Some(timeout));
        }
        _ => {}
    }
}

fn wait_for_shutdown(shutdown_rx: &mpsc::Receiver<()>, timeout: Duration) -> bool {
    match shutdown_rx.recv_timeout(timeout) {
        Ok(_) => true,
        Err(mpsc::RecvTimeoutError::Timeout) => false,
        Err(_) => true,
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms_i64() -> i64 {
    let value = now_ms();
    if value > i64::MAX as u64 {
        i64::MAX
    } else {
        value as i64
    }
}

fn relay_url_for(port: u16) -> String {
    format!("http://localhost:{port}")
}

fn wait_for_daemon_state(retries: usize, delay: Duration) -> Option<DaemonState> {
    for _ in 0..retries {
        if let Some(state) = read_state() {
            return Some(state);
        }
        thread::sleep(delay);
    }
    None
}

fn append_log(state: &Arc<Mutex<AppState>>, text: String) {
    if let Ok(mut guard) = state.lock() {
        guard.push_log(text);
    }
}

fn queue_inbound_message(state: &Arc<Mutex<AppState>>, envelope: Envelope) -> bool {
    if let Ok(mut guard) = state.lock() {
        guard.push_inbound(envelope);
        return true;
    }
    false
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
            for line in reader.lines().map_while(Result::ok) {
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
            for line in reader.lines().map_while(Result::ok) {
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
            for line in reader.lines().map_while(Result::ok) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::{save_keys, StoredSession};
    use crate::pairing::StoredKeys;
    use crate::relay::jwt::{JwtProvider, TokenPayload};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{MutexGuard, OnceLock};

    fn temp_dir(label: &str) -> PathBuf {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_millis())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("yuanio-{label}-{now}"));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();
        match LOCK.get_or_init(|| std::sync::Mutex::new(())).lock() {
            Ok(guard) => guard,
            Err(err) => err.into_inner(),
        }
    }

    struct EnvGuard {
        entries: Vec<(String, Option<String>)>,
    }

    impl EnvGuard {
        fn new() -> Self {
            Self { entries: Vec::new() }
        }

        fn set(&mut self, key: &str, value: impl AsRef<str>) {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value.as_ref());
            self.entries.push((key.to_string(), prev));
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.entries.drain(..).rev() {
                match value {
                    Some(prev) => std::env::set_var(key, prev),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    fn prepare_keys_with_token(dir: &PathBuf, token: &str) {
        std::env::set_var("YUANIO_KEYSTORE_DIR", dir);
        let session = StoredSession {
            schema_version: 1,
            keys: StoredKeys {
                crypto_version: "rust-ecdh".to_string(),
                protocol_version: "1.0.0".to_string(),
                namespace: "default".to_string(),
                public_key: "pub".to_string(),
                private_key: "priv".to_string(),
                device_id: "device-1".to_string(),
                session_id: "session-1".to_string(),
                session_token: token.to_string(),
                peer_public_key: "peer".to_string(),
                server_url: "http://localhost:3000".to_string(),
            },
        };
        save_keys(&session).expect("save keys");
    }

    fn prepare_keys(dir: &PathBuf) {
        prepare_keys_with_token(dir, "token-1");
    }

    fn find_free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|listener| listener.local_addr())
            .map(|addr| addr.port())
            .expect("free port")
    }

    fn sign_token(secret: &str, device_id: &str, session_id: &str) -> String {
        let provider = JwtProvider::new(secret.to_string());
        provider
            .sign_token(&TokenPayload {
                device_id: device_id.to_string(),
                session_id: session_id.to_string(),
                role: "agent".to_string(),
                namespace: "default".to_string(),
                protocol_version: "1.0.0".to_string(),
            })
            .expect("sign token")
    }

    #[test]
    fn start_daemon_works() {
        let _lock = env_lock();
        let state_path = temp_dir("daemon-state").join("daemon.json");
        std::env::set_var("YUANIO_DAEMON_STATE", &state_path);

        let app_state = Arc::new(Mutex::new(AppState::default()));
        let mut manager = ServiceManager::new();
        let result = manager.start_daemon_only(
            DaemonStartPayload { server_url: Some("http://localhost:3000".to_string()) },
            app_state.clone(),
        );
        assert!(result.is_ok());

        let _ = manager.stop_daemon_only(&app_state);
        if let Some(parent) = state_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
        std::env::remove_var("YUANIO_DAEMON_STATE");
    }

    #[test]
    fn start_bridge_works() {
        let _lock = env_lock();
        let dir = temp_dir("keystore");
        prepare_keys(&dir);

        let app_state = Arc::new(Mutex::new(AppState::default()));
        let mut manager = ServiceManager::new();
        let result = manager.start_bridge_only(
            BridgeStartPayload {
                server_url: Some("http://localhost:3000".to_string()),
                namespace: None,
            },
            app_state.clone(),
        );
        assert!(result.is_ok());
        assert!(manager.remote_bridge_handle.is_some());

        let _ = manager.stop_bridge_only(&app_state);
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("YUANIO_KEYSTORE_DIR");
    }

    #[test]
    fn rust_smoke_relay_daemon_bridge() {
        let _lock = env_lock();
        let mut env_guard = EnvGuard::new();
        let root = temp_dir("rust-smoke");
        let keystore_dir = root.join("keystore");
        let db_path = root.join("relay.db");
        let state_path = root.join("daemon").join("daemon.json");
        let _ = fs::create_dir_all(&keystore_dir);
        if let Some(parent) = state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let jwt_secret = "x".repeat(32);
        env_guard.set("JWT_SECRET", &jwt_secret);
        env_guard.set("YUANIO_DB_PATH", db_path.to_string_lossy());
        env_guard.set("YUANIO_KEYSTORE_DIR", keystore_dir.to_string_lossy());
        env_guard.set("YUANIO_DAEMON_STATE", state_path.to_string_lossy());

        let token = sign_token(&jwt_secret, "device-1", "session-1");
        prepare_keys_with_token(&keystore_dir, &token);

        let app_state = Arc::new(Mutex::new(AppState::default()));
        let mut manager = ServiceManager::new();
        let relay_port = find_free_port();
        let relay_url = relay_url_for(relay_port);

        let relay_result = manager.start_relay_only(
            RelayStartPayload { relay_port: Some(relay_port) },
            app_state.clone(),
        );
        assert!(relay_result.is_ok(), "relay start failed");

        let daemon_result = manager.start_daemon_only(
            DaemonStartPayload { server_url: Some(relay_url.clone()) },
            app_state.clone(),
        );
        assert!(daemon_result.is_ok(), "daemon start failed");

        let bridge_result = manager.start_bridge_only(
            BridgeStartPayload { server_url: Some(relay_url.clone()), namespace: None },
            app_state.clone(),
        );
        assert!(bridge_result.is_ok(), "bridge start failed");
        assert!(manager.remote_bridge_handle.is_some(), "bridge handle missing");

        let _ = manager.stop_bridge_only(&app_state);
        let _ = manager.stop_daemon_only(&app_state);
        let _ = manager.stop_relay_only(&app_state);
        let _ = fs::remove_dir_all(&root);
    }
}

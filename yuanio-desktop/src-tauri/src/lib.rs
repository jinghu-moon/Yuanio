mod app_core;
mod config;
mod crypto;
mod daemon;
mod daemon_state;
mod doctor;
mod keystore;
mod monitor;
mod net;
mod pairing;
mod remote_bridge;
mod relay;
mod services;
mod skills;
mod ws_client;

use app_core::{
    app_logs_clear,
    app_logs,
    app_status,
    pairing_cancel,
    pairing_join,
    pairing_poll,
    pairing_prepare,
    pairing_start,
    relay_send_dummy,
    relay_start,
    relay_stop,
};
use config::{config_load, config_save};
use doctor::doctor_run;
use monitor::{monitor_messages, monitor_sessions, start_monitor_realtime};
use daemon_state::read_state;
use net::local_ipv4_address;
use services::{
    BridgeStartPayload,
    CloudflaredInstallPayload,
    DaemonStartPayload,
    RelayStartPayload,
    ServiceManager,
    ServiceSnapshot,
    ServiceStartPayload,
    TunnelStartPayload,
};
use skills::{
    skills_install_cancel,
    skills_install_commit,
    skills_install_prepare,
    skills_install_status,
    skills_list,
    skills_logs,
};
use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Serialize)]
pub(crate) struct DaemonStatus {
    running: bool,
    pid: Option<u32>,
    port: Option<u16>,
    version: Option<String>,
    started_at: Option<String>,
    sessions: Option<Vec<String>>,
}

pub(crate) fn resolve_repo_root() -> PathBuf {
    if let Ok(root) = env::var("YUANIO_REPO_ROOT") {
        return PathBuf::from(root);
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if has_packages_dir(&cwd) {
        return cwd;
    }
    if let Some(parent) = cwd.parent() {
        if has_packages_dir(parent) {
            return parent.to_path_buf();
        }
        if let Some(grand) = parent.parent() {
            if has_packages_dir(grand) {
                return grand.to_path_buf();
            }
        }
        return parent.to_path_buf();
    }
    cwd
}

fn has_packages_dir(path: &Path) -> bool {
    path.join("packages").is_dir()
}

fn status_from_state(state: Option<daemon_state::DaemonState>) -> DaemonStatus {
    match state {
        Some(value) => DaemonStatus {
            running: true,
            pid: Some(value.pid),
            port: Some(value.port),
            version: Some(value.version),
            started_at: Some(value.started_at),
            sessions: Some(value.sessions),
        },
        None => DaemonStatus {
            running: false,
            pid: None,
            port: None,
            version: None,
            started_at: None,
            sessions: None,
        },
    }
}

#[tauri::command]
fn daemon_status() -> DaemonStatus {
    status_from_state(read_state())
}

#[tauri::command]
fn local_ipv4() -> Option<String> {
    local_ipv4_address()
}

#[derive(Serialize)]
struct SystemInfo {
    os: String,
    arch: String,
    pid: u32,
}

#[tauri::command]
fn system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        pid: std::process::id(),
    }
}

#[tauri::command]
fn service_state(services: tauri::State<'_, Arc<Mutex<ServiceManager>>>) -> ServiceSnapshot {
    let mut manager = services.lock().expect("service manager lock");
    manager.snapshot()
}

#[tauri::command]
fn service_start_relay(
    payload: RelayStartPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.start_relay_only(payload, app_handle)
}

#[tauri::command]
fn service_stop_relay(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.stop_relay_only(&app_handle)
}

#[tauri::command]
fn service_start_tunnel(
    payload: TunnelStartPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let manager_handle = services.inner().clone();
    let app_handle = app_state.inner().clone();
    let mut manager = manager_handle.lock().map_err(|_| "服务状态被占用")?;
    manager.start_tunnel_only(manager_handle.clone(), payload, app_handle)
}

#[tauri::command]
fn service_stop_tunnel(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.stop_tunnel_only(&app_handle)
}

#[tauri::command]
fn service_start_daemon(
    payload: DaemonStartPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.start_daemon_only(payload, app_handle)
}

#[tauri::command]
fn service_stop_daemon(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.stop_daemon_only(&app_handle)
}

#[tauri::command]
fn service_start_bridge(
    payload: BridgeStartPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.start_bridge_only(payload, app_handle)
}

#[tauri::command]
fn service_stop_bridge(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.stop_bridge_only(&app_handle)
}

#[tauri::command]
fn service_start_profile(
    payload: ServiceStartPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let manager_handle = services.inner().clone();
    let app_handle = app_state.inner().clone();
    let mut manager = manager_handle.lock().map_err(|_| "服务状态被占用")?;
    manager.start_profile(manager_handle.clone(), payload, app_handle)
}

#[tauri::command]
fn service_stop_all(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.stop_all(&app_handle)
}

#[tauri::command]
fn remote_bridge_reload(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> Result<ServiceSnapshot, String> {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().map_err(|_| "服务状态被占用")?;
    manager.reload_remote_bridge(app_handle)
}

#[tauri::command]
fn cloudflared_refresh(
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> services::CloudflaredServiceState {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().expect("service manager lock");
    manager.refresh_cloudflared(app_handle)
}

#[tauri::command]
fn cloudflared_install(
    payload: CloudflaredInstallPayload,
    services: tauri::State<'_, Arc<Mutex<ServiceManager>>>,
    app_state: tauri::State<'_, Arc<Mutex<app_core::AppState>>>,
) -> services::CloudflaredServiceState {
    let app_handle = app_state.inner().clone();
    let mut manager = services.lock().expect("service manager lock");
    manager.install_cloudflared(payload, app_handle)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = app_core::init_state();
    let service_manager = Arc::new(Mutex::new(ServiceManager::new()));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .manage(service_manager)
        .setup(|app| {
            start_monitor_realtime(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_status,
            local_ipv4,
            system_info,
            service_state,
            service_start_relay,
            service_stop_relay,
            service_start_tunnel,
            service_stop_tunnel,
            service_start_daemon,
            service_stop_daemon,
            service_start_bridge,
            service_stop_bridge,
            service_start_profile,
            service_stop_all,
            remote_bridge_reload,
            cloudflared_refresh,
            cloudflared_install,
            config_load,
            config_save,
            skills_list,
            skills_logs,
            skills_install_prepare,
            skills_install_status,
            skills_install_commit,
            skills_install_cancel,
            doctor_run,
            app_status,
            app_logs,
            app_logs_clear,
            pairing_start,
            pairing_prepare,
            pairing_poll,
            pairing_cancel,
            pairing_join,
            monitor_sessions,
            monitor_messages,
            relay_start,
            relay_stop,
            relay_send_dummy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

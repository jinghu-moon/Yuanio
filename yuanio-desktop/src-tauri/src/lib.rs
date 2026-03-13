mod app_core;
mod crypto;
mod daemon_state;
mod keystore;
mod monitor;
mod net;
mod pairing;
mod services;
mod ws_client;

use app_core::{
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
use monitor::{monitor_messages, monitor_sessions};
use daemon_state::read_state;
use net::local_ipv4_address;
use services::{CloudflaredInstallPayload, ServiceManager, ServiceSnapshot, ServiceStartPayload};
use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
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

pub(crate) fn resolve_cli_entry() -> PathBuf {
    if let Ok(entry) = env::var("YUANIO_CLI_ENTRY") {
        return PathBuf::from(entry);
    }
    resolve_repo_root()
        .join("packages")
        .join("cli")
        .join("src")
        .join("index.ts")
}

pub(crate) fn resolve_bun_cmd() -> String {
    env::var("YUANIO_BUN_CMD").unwrap_or_else(|_| "bun".to_string())
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

pub(crate) fn daemon_start(server_url: String) -> Result<DaemonStatus, String> {
    let cli_entry = resolve_cli_entry();
    let bun_cmd = resolve_bun_cmd();
    Command::new(bun_cmd)
        .arg("run")
        .arg(cli_entry)
        .arg("daemon")
        .arg("start")
        .arg("--server")
        .arg(server_url)
        .spawn()
        .map_err(|err| format!("启动 daemon 失败：{err}"))?;
    thread::sleep(Duration::from_millis(600));
    Ok(daemon_status())
}

pub(crate) fn daemon_stop() -> Result<DaemonStatus, String> {
    let cli_entry = resolve_cli_entry();
    let bun_cmd = resolve_bun_cmd();
    Command::new(bun_cmd)
        .arg("run")
        .arg(cli_entry)
        .arg("daemon")
        .arg("stop")
        .status()
        .map_err(|err| format!("停止 daemon 失败：{err}"))?;
    thread::sleep(Duration::from_millis(300));
    Ok(daemon_status())
}

#[tauri::command]
fn service_state(services: tauri::State<'_, Arc<Mutex<ServiceManager>>>) -> ServiceSnapshot {
    let mut manager = services.lock().expect("service manager lock");
    manager.snapshot()
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
        .invoke_handler(tauri::generate_handler![
            daemon_status,
            local_ipv4,
            service_state,
            service_start_profile,
            service_stop_all,
            remote_bridge_reload,
            cloudflared_refresh,
            cloudflared_install,
            app_status,
            app_logs,
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

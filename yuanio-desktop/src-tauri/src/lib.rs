use serde::Serialize;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

#[derive(Serialize)]
struct DaemonStatus {
    running: bool,
    pid: Option<u32>,
    port: Option<u16>,
    version: Option<String>,
    started_at: Option<String>,
    sessions: Option<Vec<String>>,
}

#[derive(Serialize, serde::Deserialize)]
struct DaemonState {
    pid: u32,
    port: u16,
    version: String,
    #[serde(rename = "startedAt")]
    started_at: String,
    sessions: Vec<String>,
}

fn resolve_state_path() -> PathBuf {
    if let Ok(path) = env::var("YUANIO_DAEMON_STATE") {
        return PathBuf::from(path);
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".yuanio").join("daemon.json")
}

fn read_state() -> Option<DaemonState> {
    let path = resolve_state_path();
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn resolve_repo_root() -> PathBuf {
    if let Ok(root) = env::var("YUANIO_REPO_ROOT") {
        return PathBuf::from(root);
    }
    env::current_dir()
        .ok()
        .and_then(|cwd| cwd.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_cli_entry() -> PathBuf {
    if let Ok(entry) = env::var("YUANIO_CLI_ENTRY") {
        return PathBuf::from(entry);
    }
    resolve_repo_root()
        .join("packages")
        .join("cli")
        .join("src")
        .join("index.ts")
}

fn resolve_bun_cmd() -> String {
    env::var("YUANIO_BUN_CMD").unwrap_or_else(|_| "bun".to_string())
}

fn status_from_state(state: Option<DaemonState>) -> DaemonStatus {
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
fn daemon_start(server_url: String) -> Result<DaemonStatus, String> {
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

#[tauri::command]
fn daemon_stop() -> Result<DaemonStatus, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            daemon_status,
            daemon_start,
            daemon_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

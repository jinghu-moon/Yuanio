use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct DaemonState {
    pub pid: u32,
    pub port: u16,
    pub version: String,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    pub sessions: Vec<String>,
}

pub fn resolve_state_path() -> PathBuf {
    if let Ok(path) = env::var("YUANIO_DAEMON_STATE") {
        return PathBuf::from(path);
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".yuanio").join("daemon.json")
}

pub fn remove_state_file() -> Result<(), String> {
    let path = resolve_state_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除 daemon state 失败: {e}"))?;
    }
    Ok(())
}

pub fn read_state() -> Option<DaemonState> {
    let path = resolve_state_path();
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_state(state: &DaemonState) -> Result<(), String> {
    let path = resolve_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 daemon 目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(state).map_err(|e| format!("序列化 daemon state 失败: {e}"))?;
    fs::write(path, payload).map_err(|e| format!("写入 daemon state 失败: {e}"))?;
    Ok(())
}

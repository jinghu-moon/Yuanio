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

fn resolve_state_path() -> PathBuf {
    if let Ok(path) = env::var("YUANIO_DAEMON_STATE") {
        return PathBuf::from(path);
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".yuanio").join("daemon.json")
}

pub fn read_state() -> Option<DaemonState> {
    let path = resolve_state_path();
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

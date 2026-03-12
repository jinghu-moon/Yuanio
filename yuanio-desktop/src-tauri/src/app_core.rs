use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::keystore::{load_keys, save_keys, StoredSession};
use crate::pairing::{join_pairing, start_pairing, ReqwestPairingClient};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingStartResponse {
    pub pairing_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingJoinResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSessionInfo {
    pub session_id: String,
    pub device_id: String,
    pub namespace: String,
    pub server_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatus {
    pub paired: bool,
    pub session: Option<StoredSessionInfo>,
}

#[derive(Debug, Default)]
pub struct AppState {
    pub status: Option<AppStatus>,
    pub logs: Vec<String>,
}

impl AppState {
    fn push_log(&mut self, text: String) {
        self.logs.push(text);
        if self.logs.len() > 40 {
            let overflow = self.logs.len() - 40;
            self.logs.drain(0..overflow);
        }
    }
}

fn summarize_session(session: &StoredSession) -> StoredSessionInfo {
    StoredSessionInfo {
        session_id: session.keys.session_id.clone(),
        device_id: session.keys.device_id.clone(),
        namespace: session.keys.namespace.clone(),
        server_url: session.keys.server_url.clone(),
    }
}

fn init_status_from_disk() -> AppStatus {
    match load_keys() {
        Ok(Some(session)) => AppStatus {
            paired: true,
            session: Some(summarize_session(&session)),
        },
        _ => AppStatus {
            paired: false,
            session: None,
        },
    }
}

#[tauri::command]
pub fn app_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> AppStatus {
    let mut guard = state.lock().unwrap();
    if guard.status.is_none() {
        guard.status = Some(init_status_from_disk());
    }
    guard.status.clone().unwrap_or(AppStatus { paired: false, session: None })
}

#[tauri::command]
pub fn app_logs(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Vec<String> {
    let guard = state.lock().unwrap();
    guard.logs.clone()
}

#[tauri::command]
pub fn pairing_start(server_url: String, namespace: Option<String>, state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<PairingStartResponse, String> {
    let ns = namespace.unwrap_or_else(|| "default".to_string());
    let client = ReqwestPairingClient::new()?;
    let derived = start_pairing(&client, &server_url, &ns)?;
    save_keys(&derived.session)?;

    let mut guard = state.lock().unwrap();
    guard.status = Some(AppStatus {
        paired: true,
        session: Some(summarize_session(&derived.session)),
    });
    guard.push_log(format!("配对完成: session={} device={}", derived.session.keys.session_id, derived.session.keys.device_id));

    Ok(PairingStartResponse {
        pairing_code: derived.pairing_code,
    })
}

#[tauri::command]
pub fn pairing_join(server_url: String, code: String, state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<PairingJoinResponse, String> {
    if code.trim().is_empty() {
        return Err("配对码为空".to_string());
    }
    let client = ReqwestPairingClient::new()?;
    let derived = join_pairing(&client, &server_url, code.trim())?;
    save_keys(&derived.session)?;

    let mut guard = state.lock().unwrap();
    guard.status = Some(AppStatus {
        paired: true,
        session: Some(summarize_session(&derived.session)),
    });
    guard.push_log(format!("加入配对完成: session={} device={}", derived.session.keys.session_id, derived.session.keys.device_id));

    Ok(PairingJoinResponse {
        session_id: derived.session.keys.session_id,
    })
}

#[tauri::command]
pub fn relay_start(server_url: String, state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<AppStatus, String> {
    let session = load_keys()?.ok_or_else(|| "尚未配对，无法启动 relay".to_string())?;
    if session.keys.server_url != server_url {
        let mut guard = state.lock().unwrap();
        guard.push_log(format!("切换 relay 目标: {} -> {}", session.keys.server_url, server_url));
    }
    let mut guard = state.lock().unwrap();
    guard.push_log(format!("准备启动 relay: {}", server_url));
    guard.status = Some(AppStatus {
        paired: true,
        session: Some(summarize_session(&session)),
    });
    Ok(guard.status.clone().unwrap())
}

#[tauri::command]
pub fn relay_stop(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<AppStatus, String> {
    let mut guard = state.lock().unwrap();
    guard.push_log("已请求停止 relay".to_string());
    if guard.status.is_none() {
        guard.status = Some(init_status_from_disk());
    }
    Ok(guard.status.clone().unwrap())
}

#[tauri::command]
pub fn relay_send_dummy(message: String, state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("消息为空".to_string());
    }
    let mut guard = state.lock().unwrap();
    guard.push_log(format!("发送测试消息: {}", message.trim()));
    Ok(())
}

pub fn init_state() -> Arc<Mutex<AppState>> {
    Arc::new(Mutex::new(AppState::default()))
}

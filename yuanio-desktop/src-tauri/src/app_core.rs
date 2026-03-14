use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::keystore::{load_keys, save_keys, StoredSession};
use crate::pairing::{
    create_pairing,
    finalize_pairing,
    join_pairing,
    start_pairing,
    PendingPairing,
    PairingClient,
    ReqwestPairingClient,
};

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
    pub logs: Vec<AppLogEntry>,
    pub pending_pairing: Option<PendingPairingState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppLogEntry {
    pub ts: u64,
    pub source: String,
    pub level: String,
    pub text: String,
}

impl AppState {
    pub fn push_log(&mut self, text: String) {
        let (source, cleaned) = split_log_source(&text);
        self.logs.push(AppLogEntry {
            ts: now_ms(),
            source,
            level: "info".to_string(),
            text: cleaned,
        });
        if self.logs.len() > 200 {
            let overflow = self.logs.len() - 200;
            self.logs.drain(0..overflow);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn split_log_source(text: &str) -> (String, String) {
    if let Some(rest) = text.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let source = rest[..end].trim();
            let message = rest[(end + 1)..].trim();
            if !source.is_empty() {
                return (source.to_string(), message.to_string());
            }
        }
    }
    ("ops".to_string(), text.trim().to_string())
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

#[derive(Debug, Clone)]
pub struct PendingPairingState {
    pub pending: PendingPairing,
    pub created_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingPrepareResponse {
    pub pairing_code: String,
    pub server_url: String,
    pub namespace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPollResponse {
    pub status: String,
    pub message: Option<String>,
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
pub fn app_logs(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Vec<AppLogEntry> {
    let guard = state.lock().unwrap();
    guard.logs.clone()
}

#[tauri::command]
pub fn app_logs_clear(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    guard.logs.clear();
    Ok(())
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
    guard.pending_pairing = None;
    guard.push_log(format!("配对完成: session={} device={}", derived.session.keys.session_id, derived.session.keys.device_id));

    Ok(PairingStartResponse {
        pairing_code: derived.pairing_code,
    })
}

#[tauri::command]
pub fn pairing_prepare(
    server_url: String,
    namespace: Option<String>,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<PairingPrepareResponse, String> {
    let ns = namespace.unwrap_or_else(|| "default".to_string());
    let client = ReqwestPairingClient::new()?;
    let pending = create_pairing(&client, &server_url, &ns)?;

    let mut guard = state.lock().unwrap();
    guard.pending_pairing = Some(PendingPairingState {
        pending: pending.clone(),
        created_at: Instant::now(),
    });
    guard.push_log(format!("已创建配对码: {}", pending.create.pairing_code));

    Ok(PairingPrepareResponse {
        pairing_code: pending.create.pairing_code,
        server_url,
        namespace: ns,
    })
}

#[tauri::command]
pub fn pairing_poll(
    code: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<PairingPollResponse, String> {
    let pending_state = {
        let guard = state.lock().unwrap();
        guard.pending_pairing.clone()
    };

    let Some(pending_state) = pending_state else {
        return Ok(PairingPollResponse {
            status: "idle".to_string(),
            message: Some("没有进行中的配对".to_string()),
        });
    };

    if pending_state.pending.create.pairing_code != code {
        return Ok(PairingPollResponse {
            status: "error".to_string(),
            message: Some("配对码不匹配".to_string()),
        });
    }

    if pending_state.created_at.elapsed() > Duration::from_secs(300) {
        let mut guard = state.lock().unwrap();
        guard.pending_pairing = None;
        guard.push_log("配对超时".to_string());
        return Ok(PairingPollResponse {
            status: "timeout".to_string(),
            message: Some("配对超时".to_string()),
        });
    }

    let client = ReqwestPairingClient::new()?;
    let status = client.poll_status(
        &pending_state.pending.server_url,
        &pending_state.pending.create.pairing_code,
    )?;

    if status.joined {
        if let Some(app_public_key) = status.app_public_key {
            let derived = finalize_pairing(pending_state.pending.clone(), app_public_key)?;
            save_keys(&derived.session)?;

            let mut guard = state.lock().unwrap();
            guard.pending_pairing = None;
            guard.status = Some(AppStatus {
                paired: true,
                session: Some(summarize_session(&derived.session)),
            });
            guard.push_log(format!(
                "配对完成: session={} device={}",
                derived.session.keys.session_id,
                derived.session.keys.device_id
            ));

            return Ok(PairingPollResponse {
                status: "success".to_string(),
                message: None,
            });
        }
    }

    Ok(PairingPollResponse {
        status: "waiting".to_string(),
        message: None,
    })
}

#[tauri::command]
pub fn pairing_cancel(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    guard.pending_pairing = None;
    guard.push_log("已取消配对".to_string());
    Ok(())
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
    guard.pending_pairing = None;
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

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tungstenite::{connect, Message};
use url::Url;

use crate::crypto::{derive_aes_key, DeriveKeyParams, DEFAULT_E2EE_INFO};
use crate::keystore::load_keys;

const PROTOCOL_VERSION: &str = "1.0.0";
const REALTIME_RETRY_DELAY_MS: u64 = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSession {
    pub session_id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub online_count: u32,
    #[serde(default)]
    pub has_agent_online: bool,
    #[serde(default)]
    pub has_app_online: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSessionsPayload {
    pub current_session_id: Option<String>,
    pub sessions: Vec<MonitorSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionsResponse {
    pub current_session_id: Option<String>,
    pub sessions: Option<Vec<MonitorSession>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorLine {
    pub id: String,
    pub ts: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorMessagesResponse {
    pub lines: Vec<MonitorLine>,
    pub next_cursor: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorMessagesRequest {
    pub session_id: String,
    pub after_ts: Option<u64>,
    pub after_cursor: Option<u64>,
    pub limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagesResponse {
    pub messages: Option<Vec<RawMessage>>,
    pub next_cursor: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    pub id: Option<String>,
    pub payload: Option<String>,
    pub ts: Option<u64>,
    pub seq: Option<u64>,
    #[serde(rename = "session_id", alias = "sessionId")]
    pub session_id: Option<String>,
    pub source: Option<String>,
    pub target: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(rename = "pty_id", alias = "ptyId")]
    pub pty_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WsFrame {
    #[serde(rename = "type")]
    kind: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct WsEnvelope {
    pub id: Option<String>,
    pub payload: Option<Value>,
    pub ts: Option<u64>,
    pub seq: Option<u64>,
    #[serde(rename = "sessionId", alias = "session_id")]
    pub session_id: Option<String>,
    pub source: Option<String>,
    pub target: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(rename = "ptyId", alias = "pty_id")]
    pub pty_id: Option<String>,
}

#[derive(Serialize)]
struct EnvelopeAad<'a> {
    v: u8,
    id: &'a str,
    seq: u64,
    source: &'a str,
    target: &'a str,
    #[serde(rename = "sessionId")]
    session_id: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
    ts: u64,
    #[serde(rename = "ptyId", skip_serializing_if = "Option::is_none")]
    pty_id: Option<&'a str>,
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn load_session_keys() -> Result<crate::keystore::StoredSession, String> {
    load_keys()?.ok_or_else(|| "尚未配对，无法读取监控数据".to_string())
}

fn derive_session_key(keys: &crate::pairing::StoredKeys) -> Result<Vec<u8>, String> {
    match keys.crypto_version.as_str() {
        "rust-ecdh" | "webcrypto" => derive_aes_key(DeriveKeyParams {
            private_key: keys.private_key.clone(),
            public_key: keys.peer_public_key.clone(),
            salt: keys.session_id.clone(),
            info: Some(DEFAULT_E2EE_INFO.to_string()),
        }),
        other => Err(format!("不支持的加密版本: {}", other)),
    }
}

fn build_aad(message: &RawMessage, session_id: &str) -> Result<String, String> {
    let id = message.id.as_deref().ok_or_else(|| "缺少消息 id".to_string())?;
    let source = message.source.as_deref().ok_or_else(|| "缺少 source".to_string())?;
    let target = message.target.as_deref().ok_or_else(|| "缺少 target".to_string())?;
    let kind = message.kind.as_deref().ok_or_else(|| "缺少 type".to_string())?;
    let ts = message.ts.ok_or_else(|| "缺少 ts".to_string())?;
    let seq = message.seq.unwrap_or(0);

    let aad = EnvelopeAad {
        v: 1,
        id,
        seq,
        source,
        target,
        session_id,
        kind,
        ts,
        pty_id: message.pty_id.as_deref(),
    };
    serde_json::to_string(&aad).map_err(|e| format!("序列化 AAD 失败: {e}"))
}

fn decrypt_payload(payload: &str, key: &[u8], aad: &str) -> Result<String, String> {
    let data = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("payload base64 解析失败: {e}"))?;
    if data.len() < 12 {
        return Err("payload 长度不足".to_string());
    }
    let (iv, ciphertext) = data.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "创建解密器失败".to_string())?;
    let nonce = Nonce::from_slice(iv);
    let plaintext = cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad: aad.as_bytes() })
        .map_err(|_| "解密失败".to_string())?;
    String::from_utf8(plaintext).map_err(|e| format!("解密输出非 UTF-8: {e}"))
}

pub fn start_monitor_realtime(app_handle: AppHandle) {
    static STARTED: OnceLock<Mutex<bool>> = OnceLock::new();
    let guard = STARTED.get_or_init(|| Mutex::new(false));
    let mut started = guard.lock().unwrap();
    if *started {
        return;
    }
    *started = true;
    thread::spawn(move || monitor_realtime_loop(app_handle));
}

fn monitor_realtime_loop(app_handle: AppHandle) {
    loop {
        let session = match load_session_keys() {
            Ok(value) => value,
            Err(err) => {
                emit_monitor_status(&app_handle, "waiting", &err);
                thread::sleep(Duration::from_millis(REALTIME_RETRY_DELAY_MS));
                continue;
            }
        };
        let key = match derive_session_key(&session.keys) {
            Ok(value) => value,
            Err(err) => {
                emit_monitor_status(&app_handle, "error", &err);
                thread::sleep(Duration::from_millis(REALTIME_RETRY_DELAY_MS));
                continue;
            }
        };
        let ws_url = match build_ws_url(&session.keys.server_url) {
            Ok(value) => value,
            Err(err) => {
                emit_monitor_status(&app_handle, "error", &err);
                thread::sleep(Duration::from_millis(REALTIME_RETRY_DELAY_MS));
                continue;
            }
        };

        let connect_result = connect(ws_url.as_str());
        let Ok((mut socket, _)) = connect_result else {
            emit_monitor_status(&app_handle, "error", "realtime connect failed");
            thread::sleep(Duration::from_millis(REALTIME_RETRY_DELAY_MS));
            continue;
        };

        emit_monitor_status(&app_handle, "connected", "realtime connected");
        let hello = serde_json::json!({
            "type": "hello",
            "data": {
                "token": session.keys.session_token,
                "protocolVersion": PROTOCOL_VERSION,
            }
        });
        let _ = socket.send(Message::Text(hello.to_string()));

        loop {
            let msg = match socket.read() {
                Ok(value) => value,
                Err(err) => {
                    emit_monitor_status(&app_handle, "disconnected", &format!("realtime closed: {err}"));
                    break;
                }
            };
            let text = match msg {
                Message::Text(value) => value,
                Message::Binary(value) => String::from_utf8_lossy(&value).to_string(),
                _ => continue,
            };
            if let Ok(line) = parse_ws_line(&text, &key, &session.keys.session_id) {
                let _ = app_handle.emit("monitor-line", line);
            }
        }

        thread::sleep(Duration::from_millis(REALTIME_RETRY_DELAY_MS));
    }
}

fn build_ws_url(server_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(server_url).map_err(|e| format!("解析 server_url 失败: {e}"))?;
    let scheme = match url.scheme() {
        "https" | "wss" => "wss",
        _ => "ws",
    };
    url.set_scheme(scheme).map_err(|_| "设置 ws 协议失败".to_string())?;
    url.set_path("/relay-ws");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn parse_ws_line(text: &str, key: &[u8], fallback_session_id: &str) -> Result<MonitorLine, String> {
    let frame = serde_json::from_str::<WsFrame>(text).map_err(|_| "ws frame parse failed".to_string())?;
    if frame.kind != "message" {
        return Err("non-message".to_string());
    }
    let data = frame.data.ok_or_else(|| "ws frame missing data".to_string())?;
    let env = serde_json::from_value::<WsEnvelope>(data).map_err(|_| "ws envelope parse failed".to_string())?;
    let payload_text = match env.payload {
        Some(Value::String(value)) => value,
        _ => return Err("payload not text".to_string()),
    };
    let id = env.id.ok_or_else(|| "missing id".to_string())?;
    let ts = env.ts.unwrap_or_else(|| chrono_fallback_ts());
    let session_id = env.session_id.unwrap_or_else(|| fallback_session_id.to_string());
    let kind = env.kind.unwrap_or_else(|| "unknown".to_string());
    let raw = RawMessage {
        id: Some(id.clone()),
        payload: Some(payload_text.clone()),
        ts: Some(ts),
        seq: env.seq,
        session_id: Some(session_id.clone()),
        source: env.source,
        target: env.target,
        kind: Some(kind.clone()),
        pty_id: env.pty_id,
    };
    let aad = match build_aad(&raw, &session_id) {
        Ok(value) => value,
        Err(err) => {
            return Ok(MonitorLine {
                id,
                ts,
                kind,
                text: format!("解密失败: {err}"),
                session_id,
            });
        }
    };
    let text = decrypt_payload(&payload_text, key, &aad).unwrap_or_else(|err| format!("解密失败: {err}"));
    Ok(MonitorLine {
        id,
        ts,
        kind,
        text,
        session_id,
    })
}

fn chrono_fallback_ts() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_monitor_status(app_handle: &AppHandle, status: &str, message: &str) {
    let payload = serde_json::json!({
        "status": status,
        "message": message,
    });
    let _ = app_handle.emit("monitor-realtime", payload);
}

#[tauri::command]
pub fn monitor_sessions() -> Result<MonitorSessionsPayload, String> {
    let session = load_session_keys()?;
    let client = http_client()?;
    let url = format!("{}/api/v1/sessions", session.keys.server_url.trim_end_matches('/'));
    let res = client
        .get(url)
        .header("Authorization", format!("Bearer {}", session.keys.session_token))
        .send()
        .map_err(|e| format!("获取会话列表失败: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("获取会话列表失败: HTTP {}", res.status()));
    }

    let payload = res.json::<SessionsResponse>().map_err(|e| format!("解析会话列表失败: {e}"))?;
    Ok(MonitorSessionsPayload {
        current_session_id: payload.current_session_id,
        sessions: payload.sessions.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn monitor_messages(payload: MonitorMessagesRequest) -> Result<MonitorMessagesResponse, String> {
    let session = load_session_keys()?;
    let key = derive_session_key(&session.keys)?;
    let client = http_client()?;

    let after_ts = payload.after_ts.unwrap_or(0);
    let after_cursor = payload.after_cursor.unwrap_or(0);
    let limit = payload.limit.unwrap_or(200);
    let url = if after_cursor > 0 {
        format!(
            "{}/api/v1/sessions/{}/messages?afterCursor={}&limit={}",
            session.keys.server_url.trim_end_matches('/'),
            payload.session_id,
            after_cursor,
            limit
        )
    } else {
        format!(
            "{}/api/v1/sessions/{}/messages?after={}&limit={}",
            session.keys.server_url.trim_end_matches('/'),
            payload.session_id,
            after_ts,
            limit
        )
    };

    let res = client
        .get(url)
        .header("Authorization", format!("Bearer {}", session.keys.session_token))
        .send()
        .map_err(|e| format!("获取消息失败: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("获取消息失败: HTTP {}", res.status()));
    }

    let response = res.json::<MessagesResponse>().map_err(|e| format!("解析消息失败: {e}"))?;
    let mut lines = Vec::new();
    let rows = response.messages.unwrap_or_default();
    for row in rows {
        let id = match row.id.as_deref() {
            Some(value) => value,
            None => continue,
        };
        let payload_text = match row.payload.as_deref() {
            Some(value) => value,
            None => continue,
        };
        let ts = match row.ts {
            Some(value) => value,
            None => continue,
        };
        let session_id = row.session_id.as_deref().unwrap_or(&payload.session_id);
        let kind = row.kind.as_deref().unwrap_or("unknown");

        let aad = match build_aad(&row, session_id) {
            Ok(value) => value,
            Err(err) => {
                lines.push(MonitorLine {
                    id: id.to_string(),
                    ts,
                    kind: kind.to_string(),
                    text: format!("解密失败: {err}"),
                    session_id: session_id.to_string(),
                });
                continue;
            }
        };

        let text = match decrypt_payload(payload_text, &key, &aad) {
            Ok(value) => value,
            Err(err) => format!("解密失败: {err}"),
        };

        lines.push(MonitorLine {
            id: id.to_string(),
            ts,
            kind: kind.to_string(),
            text,
            session_id: session_id.to_string(),
        });
    }

    Ok(MonitorMessagesResponse {
        lines,
        next_cursor: response.next_cursor,
    })
}

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::crypto::{derive_aes_key, DeriveKeyParams, DEFAULT_E2EE_INFO};
use crate::keystore::load_keys;

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

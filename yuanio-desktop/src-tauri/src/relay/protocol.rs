use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const PROTOCOL_VERSION: &str = "1.0.0";
pub const DEFAULT_NAMESPACE: &str = "default";
pub const MAX_ENVELOPE_STRING_PAYLOAD_CHARS: usize = 1_048_576;
pub const MAX_ENVELOPE_BINARY_PAYLOAD_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub id: String,
    pub seq: i64,
    pub source: String,
    pub target: String,
    pub session_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub pty_id: Option<String>,
    pub ts: i64,
    #[serde(default)]
    pub relay_ts: Option<i64>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckMessage {
    pub message_id: String,
    pub source: String,
    pub session_id: String,
    #[serde(default)]
    pub state: Option<AckState>,
    #[serde(default)]
    pub retry_after_ms: Option<i64>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AckState {
    Ok,
    Working,
    RetryAfter,
    Terminal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceRole {
    Agent,
    App,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsHelloPayload {
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<DeviceRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsPresencePayload {
    pub session_id: String,
    pub devices: Vec<WsPresenceDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsPresenceDevice {
    pub id: String,
    pub role: DeviceRole,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum WsFrame {
    Hello(WsHelloPayload),
    Message(Envelope),
    Ack(AckMessage),
    Presence(WsPresencePayload),
    Error(WsErrorPayload),
}

pub fn normalize_namespace(value: Option<&str>) -> String {
    let raw = value.unwrap_or("").trim();
    if raw.is_empty() {
        DEFAULT_NAMESPACE.to_string()
    } else {
        raw.to_string()
    }
}

pub fn is_protocol_compatible(client_version: Option<&str>, server_version: &str) -> Result<(), String> {
    let Some(client_version) = client_version.filter(|v| !v.trim().is_empty()) else {
        return Ok(());
    };
    let client_major = parse_major(client_version).ok_or_else(|| {
        format!("invalid protocol version format ({client_version} / {server_version})")
    })?;
    let server_major = parse_major(server_version).ok_or_else(|| {
        format!("invalid protocol version format ({client_version} / {server_version})")
    })?;
    if client_major != server_major {
        return Err(format!(
            "major mismatch (client={client_version}, server={server_version})"
        ));
    }
    Ok(())
}

fn parse_major(version: &str) -> Option<u64> {
    let trimmed = version.trim();
    let idx = trimmed.find('.')?;
    trimmed[..idx].parse::<u64>().ok()
}

pub fn ack_required_types() -> HashSet<&'static str> {
    HashSet::from(["prompt", "approval_resp", "session_switch_ack", "diff_action_result"])
}

pub fn non_persisted_message_types() -> HashSet<&'static str> {
    HashSet::from([
        "stream_chunk",
        "thinking",
        "heartbeat",
        "status",
        "interaction_state",
        "terminal_output",
    ])
}

pub fn should_queue_ack_by_type(kind: &str) -> bool {
    ack_required_types().contains(kind)
}

pub fn should_persist_type(kind: &str) -> bool {
    if kind.is_empty() {
        return true;
    }
    !non_persisted_message_types().contains(kind)
}

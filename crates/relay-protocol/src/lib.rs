use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use ts_rs::TS;

pub const PROTOCOL_VERSION: &str = "1.0.0";
pub const DEFAULT_NAMESPACE: &str = "default";
pub const WS_EVENT_TYPES: [&str; 5] = ["hello", "message", "ack", "presence", "error"];
pub const MAX_ENVELOPE_STRING_PAYLOAD_CHARS: usize = 1_048_576;
pub const MAX_ENVELOPE_BINARY_PAYLOAD_BYTES: usize = 1_048_576;

macro_rules! message_types {
    ($($variant:ident => { name: $name:expr, value: $value:expr },)+) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum MessageType {
            $(
                #[serde(rename = $value)]
                $variant,
            )+
        }

        impl MessageType {
            pub const ALL: &'static [MessageType] = &[
                $(MessageType::$variant,)+
            ];

            pub const fn as_str(&self) -> &'static str {
                match self {
                    $(MessageType::$variant => $value,)+
                }
            }

            pub const fn name(&self) -> &'static str {
                match self {
                    $(MessageType::$variant => $name,)+
                }
            }
        }

        #[derive(Debug, Clone, Copy)]
        pub struct MessageTypeDef {
            pub name: &'static str,
            pub value: &'static str,
        }

        pub const MESSAGE_TYPE_DEFS: &[MessageTypeDef] = &[
            $(MessageTypeDef { name: $name, value: $value },)+
        ];
    };
}

message_types! {
    Prompt => { name: "PROMPT", value: "prompt" },
    StreamChunk => { name: "STREAM_CHUNK", value: "stream_chunk" },
    StreamEnd => { name: "STREAM_END", value: "stream_end" },
    DeviceOnline => { name: "DEVICE_ONLINE", value: "device:online" },
    DeviceOffline => { name: "DEVICE_OFFLINE", value: "device:offline" },
    Ack => { name: "ACK", value: "ack" },
    ToolCall => { name: "TOOL_CALL", value: "tool_call" },
    FileDiff => { name: "FILE_DIFF", value: "file_diff" },
    ApprovalReq => { name: "APPROVAL_REQ", value: "approval_req" },
    ApprovalResp => { name: "APPROVAL_RESP", value: "approval_resp" },
    Status => { name: "STATUS", value: "status" },
    Heartbeat => { name: "HEARTBEAT", value: "heartbeat" },
    ForegroundProbe => { name: "FOREGROUND_PROBE", value: "foreground_probe" },
    ForegroundProbeAck => { name: "FOREGROUND_PROBE_ACK", value: "foreground_probe_ack" },
    TurnState => { name: "TURN_STATE", value: "turn_state" },
    InteractionState => { name: "INTERACTION_STATE", value: "interaction_state" },
    InteractionAction => { name: "INTERACTION_ACTION", value: "interaction_action" },
    ReplayDone => { name: "REPLAY_DONE", value: "replay_done" },
    NewSession => { name: "NEW_SESSION", value: "new_session" },
    RpcReq => { name: "RPC_REQ", value: "rpc_req" },
    RpcResp => { name: "RPC_RESP", value: "rpc_resp" },
    TerminalOutput => { name: "TERMINAL_OUTPUT", value: "terminal_output" },
    HookEvent => { name: "HOOK_EVENT", value: "hook_event" },
    DeviceList => { name: "DEVICE_LIST", value: "device_list" },
    Cancel => { name: "CANCEL", value: "cancel" },
    SessionSwitch => { name: "SESSION_SWITCH", value: "session_switch" },
    SessionSwitchAck => { name: "SESSION_SWITCH_ACK", value: "session_switch_ack" },
    PtySpawn => { name: "PTY_SPAWN", value: "pty_spawn" },
    PtyInput => { name: "PTY_INPUT", value: "pty_input" },
    PtyOutput => { name: "PTY_OUTPUT", value: "pty_output" },
    PtyResize => { name: "PTY_RESIZE", value: "pty_resize" },
    PtyExit => { name: "PTY_EXIT", value: "pty_exit" },
    PtyKill => { name: "PTY_KILL", value: "pty_kill" },
    PtyAck => { name: "PTY_ACK", value: "pty_ack" },
    PtyStatus => { name: "PTY_STATUS", value: "pty_status" },
    TaskQueue => { name: "TASK_QUEUE", value: "task_queue" },
    TaskQueueStatus => { name: "TASK_QUEUE_STATUS", value: "task_queue_status" },
    TaskSummary => { name: "TASK_SUMMARY", value: "task_summary" },
    UsageReport => { name: "USAGE_REPORT", value: "usage_report" },
    DiffAction => { name: "DIFF_ACTION", value: "diff_action" },
    DiffActionResult => { name: "DIFF_ACTION_RESULT", value: "diff_action_result" },
    ScheduleCreate => { name: "SCHEDULE_CREATE", value: "schedule_create" },
    ScheduleList => { name: "SCHEDULE_LIST", value: "schedule_list" },
    ScheduleDelete => { name: "SCHEDULE_DELETE", value: "schedule_delete" },
    ScheduleTrigger => { name: "SCHEDULE_TRIGGER", value: "schedule_trigger" },
    ScheduleStatus => { name: "SCHEDULE_STATUS", value: "schedule_status" },
    PermissionMode => { name: "PERMISSION_MODE", value: "permission_mode" },
    TodoUpdate => { name: "TODO_UPDATE", value: "todo_update" },
    ModelMode => { name: "MODEL_MODE", value: "model_mode" },
    Thinking => { name: "THINKING", value: "thinking" },
    RpcRegister => { name: "RPC_REGISTER", value: "rpc_register" },
    RpcUnregister => { name: "RPC_UNREGISTER", value: "rpc_unregister" },
    SessionSpawn => { name: "SESSION_SPAWN", value: "session_spawn" },
    SessionStop => { name: "SESSION_STOP", value: "session_stop" },
    SessionList => { name: "SESSION_LIST", value: "session_list" },
    SessionStatus => { name: "SESSION_STATUS", value: "session_status" },
}

pub fn message_type_defs() -> &'static [MessageTypeDef] {
    MESSAGE_TYPE_DEFS
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub id: String,
    #[ts(type = "number")]
    pub seq: i64,
    pub source: String,
    pub target: String,
    pub session_id: String,
    #[serde(rename = "type")]
    #[ts(type = "MessageType")]
    pub kind: String,
    #[serde(default)]
    pub pty_id: Option<String>,
    #[ts(type = "number")]
    pub ts: i64,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub relay_ts: Option<i64>,
    #[ts(type = "EnvelopePayload")]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AckMessage {
    pub message_id: String,
    pub source: String,
    pub session_id: String,
    #[serde(default)]
    pub state: Option<AckState>,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub retry_after_ms: Option<i64>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AckState {
    Ok,
    Working,
    RetryAfter,
    Terminal,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum DeviceRole {
    Agent,
    App,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WsPresencePayload {
    pub session_id: String,
    pub devices: Vec<WsPresenceDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WsPresenceDevice {
    pub id: String,
    pub role: DeviceRole,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WsErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum WsFrame {
    Hello(WsHelloPayload),
    Message(Envelope),
    Ack(AckMessage),
    Presence(WsPresencePayload),
    Error(WsErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedNamespaceToken {
    pub base_token: String,
    pub namespace: String,
}

pub fn normalize_namespace(value: Option<&str>) -> String {
    let raw = value.unwrap_or("").trim();
    if raw.is_empty() {
        DEFAULT_NAMESPACE.to_string()
    } else {
        raw.to_string()
    }
}

pub fn parse_namespace_token(raw: &str) -> Option<ParsedNamespaceToken> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let sep = trimmed.rfind(':')?;
    let base_token = trimmed[..sep].trim();
    let namespace = normalize_namespace(Some(&trimmed[(sep + 1)..]));
    if base_token.is_empty() || namespace.is_empty() {
        return None;
    }
    Some(ParsedNamespaceToken {
        base_token: base_token.to_string(),
        namespace,
    })
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
        return Err(format!("major mismatch (client={client_version}, server={server_version})"));
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

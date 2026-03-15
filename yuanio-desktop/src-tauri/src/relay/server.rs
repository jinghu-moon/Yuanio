use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rand::{Rng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{timeout, Duration};

use super::config::RelayConfig;
use super::db::{ConnectionLogRow, DeliveryRow, EncryptedMessageCursorRow, EncryptedMessageRow, RelayDb};
use super::jwt::{JwtProvider, TokenPayload};
use super::protocol::{
    is_protocol_compatible, normalize_namespace, should_persist_type, should_queue_ack_by_type,
    AckMessage, Envelope, WsErrorPayload, WsFrame, WsHelloPayload, WsPresenceDevice, WsPresencePayload,
    DEFAULT_NAMESPACE, MAX_ENVELOPE_STRING_PAYLOAD_CHARS, PROTOCOL_VERSION,
};

const WS_HANDSHAKE_TIMEOUT_MS: u64 = 10_000;
const PAIRING_TTL_MS: i64 = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS: u64 = 60_000;
const RATE_LIMIT_MAX: usize = 5;
const PUSH_REGISTER_RATE_LIMIT_MAX: usize = 20;
const PUSH_REGISTER_RATE_LIMIT_WINDOW_MS: u64 = 60_000;
const ACK_TRACKING_TTL_MS: u64 = 120_000;
const ACK_SWEEP_INTERVAL_MS: u64 = 5_000;
const ACK_MARK_FLUSH_DELAY_MS: u64 = 6;
const ACK_MARK_FLUSH_BATCH_SIZE: usize = 128;
const ACK_RTT_RING_SIZE: usize = 512;
const RECENT_ACK_TTL_MS: u64 = 15_000;
const RECENT_ACK_MAX_PER_DEVICE: usize = 2_048;
const TOKEN_REFRESH_GRACE_SECONDS: u64 = 3600;
const FCM_TOKEN_MAX_LENGTH: usize = 4096;

type DeviceSenders = HashMap<String, HashMap<u64, mpsc::UnboundedSender<WsFrame>>>;
type RateLimitMap = HashMap<String, Vec<u64>>;
type RecentAckMap = HashMap<String, HashMap<String, u64>>;

#[derive(Debug, Clone)]
struct DevicePresence {
    role: String,
    count: usize,
}

#[derive(Debug, Clone)]
struct AckPendingRow {
    recv_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct PendingAckMark {
    message_id: String,
    target_device_id: String,
}

struct RelayState {
    config: RelayConfig,
    db: RelayDb,
    jwt: JwtProvider,
    senders: Mutex<DeviceSenders>,
    online_devices: Mutex<HashMap<String, HashMap<String, DevicePresence>>>,
    rate_limits: Mutex<RateLimitMap>,
    recent_acks: Mutex<RecentAckMap>,
    ack_pending: Mutex<HashMap<String, AckPendingRow>>,
    ack_mark_queue: Mutex<Vec<PendingAckMark>>,
    ack_mark_keys: Mutex<HashSet<String>>,
    ack_mark_scheduled: AtomicBool,
    ack_rtt_samples: Mutex<Vec<u64>>,
    ack_rtt_last_ms: AtomicU64,
    ack_rtt_max_ms: AtomicU64,
}

static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);

fn empty_event_loop_lag() -> Value {
    json!({
        "count": 0,
        "p50": 0,
        "p95": 0,
        "max": 0,
        "last": 0,
    })
}

fn is_fcm_enabled() -> bool {
    std::env::var("FCM_SERVICE_ACCOUNT")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn build_relay_state_snapshot(state: &RelayState, now_ms: i64) -> Value {
    let (rooms, devices, connections) = {
        let online = state.online_devices.lock().unwrap();
        let rooms = online.len();
        let mut devices = 0usize;
        for room in online.values() {
            devices += room.len();
        }
        let senders = state.senders.lock().unwrap();
        let connections: usize = senders.values().map(|entry| entry.len()).sum();
        (rooms, devices, connections)
    };
    json!({
        "status": "ready",
        "protocolVersion": PROTOCOL_VERSION,
        "serverNowMs": now_ms,
        "retryAfterMs": 0,
        "runtime": {
            "trackedSessions": rooms,
            "activeSessions": rooms,
            "warmingUpSessions": 0,
            "readySessions": rooms,
            "idleSessions": 0,
            "activeRefs": connections,
            "activeDevices": devices,
            "startupInFlight": 0,
            "reclaimedSessions": 0,
            "retryAfterMs": 0,
            "idleReclaimMs": 0,
            "sweepIntervalMs": 0
        }
    })
}

pub struct RelayServerHandle {
    shutdown_tx: oneshot::Sender<()>,
    join: JoinHandle<()>,
}

impl RelayServerHandle {
    pub fn stop(self) {
        let _ = self.shutdown_tx.send(());
        let _ = self.join.join();
    }
}

pub struct RelayServer;

impl RelayServer {
    pub fn spawn(config: RelayConfig) -> Result<RelayServerHandle, String> {
        let db = RelayDb::new(&config)?;
        let jwt = JwtProvider::new(config.jwt_secret.clone());
        let state = Arc::new(RelayState {
            config,
            db,
            jwt,
            senders: Mutex::new(HashMap::new()),
            online_devices: Mutex::new(HashMap::new()),
            rate_limits: Mutex::new(HashMap::new()),
            recent_acks: Mutex::new(HashMap::new()),
            ack_pending: Mutex::new(HashMap::new()),
            ack_mark_queue: Mutex::new(Vec::new()),
            ack_mark_keys: Mutex::new(HashSet::new()),
            ack_mark_scheduled: AtomicBool::new(false),
            ack_rtt_samples: Mutex::new(Vec::new()),
            ack_rtt_last_ms: AtomicU64::new(0),
            ack_rtt_max_ms: AtomicU64::new(0),
        });

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let join = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("relay runtime");
            runtime.block_on(start_server(state, shutdown_rx));
        });
        Ok(RelayServerHandle { shutdown_tx, join })
    }
}

async fn start_server(state: Arc<RelayState>, shutdown_rx: oneshot::Receiver<()>) {
    let sweep_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(ACK_SWEEP_INTERVAL_MS));
        loop {
            interval.tick().await;
            sweep_ack_tracking(&sweep_state);
        }
    });

    let app = build_app(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(value) => value,
        Err(_) => return,
    };

    let _ = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await;
}

fn build_app(state: Arc<RelayState>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/relay/state", get(relay_state_handler))
        .route("/relay-ws", get(relay_ws_handler))
        .route("/sessions", post(create_session))
        .route("/sessions/:id", get(get_session_messages))
        .route("/api/v1/pair/create", post(pair_create))
        .route("/api/v1/pair/join", post(pair_join))
        .route("/api/v1/pair/status/:code", get(pair_status))
        .route("/api/v1/token/revoke", post(token_revoke))
        .route("/api/v1/token/refresh", post(token_refresh))
        .route("/api/v1/push/register", post(push_register))
        .route("/api/v1/sessions/:id/messages", get(session_messages))
        .route("/api/v1/queue/pending", get(queue_pending))
        .route("/api/v1/sessions", get(session_list))
        .route("/api/v1/sessions/:id/connections", get(session_connections))
        .route("/api/v1/sessions/:id/version", get(session_version))
        .route("/api/v1/sessions/switch", post(session_switch))
        .route("/api/v1/sessions/:id/update", post(session_update))
        .with_state(state)
}

async fn relay_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RelayState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let ip = addr.ip().to_string();
    ws.on_upgrade(move |socket| handle_socket(socket, state, Some(ip)))
}

async fn health_handler(State(state): State<Arc<RelayState>>) -> impl IntoResponse {
    let now_ms = now_millis();
    let ack = summarize_ack_rtt(&state);
    let relay_state = build_relay_state_snapshot(&state, now_ms);
    Json(json!({
        "status": "ok",
        "protocolVersion": PROTOCOL_VERSION,
        "serverNowMs": now_ms,
        "relayState": relay_state,
        "eventLoopLagMs": empty_event_loop_lag(),
        "ackRttMs": ack,
        "fcm": {
            "enabled": is_fcm_enabled(),
            "pushRegisterRateLimit": {
                "max": PUSH_REGISTER_RATE_LIMIT_MAX,
                "windowMs": PUSH_REGISTER_RATE_LIMIT_WINDOW_MS,
            }
        }
    }))
}

async fn relay_state_handler(State(state): State<Arc<RelayState>>) -> impl IntoResponse {
    let now_ms = now_millis();
    let relay_state = build_relay_state_snapshot(&state, now_ms);
    let status = relay_state
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("ready");
    let status_code = if status == "warming_up" {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    (status_code, Json(relay_state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<RelayState>, ip: Option<String>) {
    let first = match timeout(Duration::from_millis(WS_HANDSHAKE_TIMEOUT_MS), socket.recv()).await {
        Ok(Some(Ok(msg))) => msg,
        _ => {
            let _ = socket
                .send(Message::Text(
                    serde_json::to_string(&WsFrame::Error(WsErrorPayload {
                        code: "handshake_timeout".to_string(),
                        message: "hello timeout".to_string(),
                        retryable: Some(false),
                    }))
                    .unwrap_or_else(|_| "{\"type\":\"error\"}".to_string()),
                ))
                .await;
            let _ = socket.close().await;
            return;
        }
    };

    let raw = match extract_payload(first) {
        Some(payload) => payload,
        None => {
            send_error(&mut socket, "bad_request", "invalid json").await;
            return;
        }
    };
    if raw.is_text && raw.bytes > MAX_ENVELOPE_STRING_PAYLOAD_CHARS {
        send_error(&mut socket, "payload_too_large", "payload too large").await;
        return;
    }
    if raw.bytes > state.config.max_payload_bytes {
        send_error(&mut socket, "payload_too_large", "payload too large").await;
        return;
    }
    let frame = match serde_json::from_str::<WsFrame>(&raw.text) {
        Ok(value) => value,
        Err(_) => {
            send_error(&mut socket, "bad_request", "invalid json").await;
            return;
        }
    };

    let WsFrame::Hello(hello) = frame else {
        send_error(&mut socket, "bad_request", "invalid hello frame").await;
        return;
    };

    let token_payload = match validate_hello(&state, &hello) {
        Ok(payload) => payload,
        Err(message) => {
            send_error(&mut socket, "auth_failed", &message).await;
            return;
        }
    };

    let namespace = normalize_namespace(hello.namespace.as_deref().or(Some(&token_payload.namespace)));
    let device_id = token_payload.device_id.clone();
    let session_id = token_payload.session_id.clone();
    let role = token_payload.role.clone();

    let _ = state
        .db
        .log_connection(&device_id, &session_id, &role, ip.as_deref(), "connect");

    let (tx, mut rx) = mpsc::unbounded_channel::<WsFrame>();
    let conn_id = register_sender(&state, &device_id, tx);
    register_online_device(&state, &namespace, &session_id, &device_id, &role);
    let _ = state.db.upsert_session_membership(&device_id, &session_id, &role);

    broadcast_presence(&state, &namespace, &session_id).await;

    loop {
        tokio::select! {
            maybe_msg = socket.recv() => {
                let Some(Ok(msg)) = maybe_msg else { break };
                let Some(payload) = extract_payload(msg) else { continue };
                if payload.is_text && payload.bytes > MAX_ENVELOPE_STRING_PAYLOAD_CHARS {
                    send_error(&mut socket, "payload_too_large", "payload too large").await;
                    break;
                }
                if payload.bytes > state.config.max_payload_bytes {
                    send_error(&mut socket, "payload_too_large", "payload too large").await;
                    break;
                }
                let frame = match serde_json::from_str::<WsFrame>(&payload.text) {
                    Ok(value) => value,
                    Err(_) => {
                        send_error(&mut socket, "bad_request", "invalid json").await;
                        continue;
                    }
                };
                match frame {
                    WsFrame::Message(envelope) => {
                        if handle_message(&state, &token_payload, envelope).await.is_err() {
                            send_error(&mut socket, "bad_request", "invalid message").await;
                        }
                    }
                    WsFrame::Ack(ack) => {
                        if handle_ack(state.clone(), &token_payload, ack).await.is_err() {
                            send_error(&mut socket, "bad_request", "invalid ack").await;
                        }
                    }
                    _ => {}
                }
            }
            maybe_frame = rx.recv() => {
                let Some(frame) = maybe_frame else { break };
                if socket
                    .send(Message::Text(serde_json::to_string(&frame).unwrap_or_default()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    }
    unregister_sender(&state, &device_id, conn_id);
    unregister_online_device(&state, &namespace, &session_id, &device_id);
    broadcast_presence(&state, &namespace, &session_id).await;
    let _ = state
        .db
        .log_connection(&device_id, &session_id, &role, ip.as_deref(), "disconnect");
}

fn validate_hello(state: &RelayState, hello: &WsHelloPayload) -> Result<TokenPayload, String> {
    if state.config.require_protocol_version && hello.protocol_version.is_none() {
        return Err("protocol version required".to_string());
    }
    is_protocol_compatible(hello.protocol_version.as_deref(), PROTOCOL_VERSION)
        .map_err(|reason| format!("protocol mismatch: {reason}"))?;
    state.jwt.verify_token(&hello.token, &state.db)
}

fn register_sender(
    state: &RelayState,
    device_id: &str,
    sender: mpsc::UnboundedSender<WsFrame>,
) -> u64 {
    let mut map = state.senders.lock().unwrap();
    let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
    map.entry(device_id.to_string())
        .or_default()
        .insert(conn_id, sender);
    conn_id
}

fn unregister_sender(state: &RelayState, device_id: &str, conn_id: u64) {
    let mut map = state.senders.lock().unwrap();
    if let Some(entry) = map.get_mut(device_id) {
        entry.remove(&conn_id);
        if entry.is_empty() {
            map.remove(device_id);
        }
    }
}

fn register_online_device(
    state: &RelayState,
    namespace: &str,
    session_id: &str,
    device_id: &str,
    role: &str,
) {
    let mut map = state.online_devices.lock().unwrap();
    let key = format!("{namespace}:{session_id}");
    let entry = map.entry(key).or_default();
    let slot = entry.entry(device_id.to_string()).or_insert(DevicePresence {
        role: role.to_string(),
        count: 0,
    });
    slot.role = role.to_string();
    slot.count += 1;
}

fn unregister_online_device(state: &RelayState, namespace: &str, session_id: &str, device_id: &str) {
    let mut map = state.online_devices.lock().unwrap();
    let key = format!("{namespace}:{session_id}");
    if let Some(entry) = map.get_mut(&key) {
        if let Some(slot) = entry.get_mut(device_id) {
            if slot.count > 1 {
                slot.count -= 1;
            } else {
                entry.remove(device_id);
            }
        }
        if entry.is_empty() {
            map.remove(&key);
        }
    }
}

async fn broadcast_presence(state: &RelayState, namespace: &str, session_id: &str) {
    let map = state.online_devices.lock().unwrap();
    let key = format!("{namespace}:{session_id}");
    let Some(entry) = map.get(&key) else { return };
    let devices = entry
        .iter()
        .map(|(id, presence)| WsPresenceDevice {
            id: id.clone(),
            role: if presence.role == "agent" {
                super::protocol::DeviceRole::Agent
            } else {
                super::protocol::DeviceRole::App
            },
            session_id: session_id.to_string(),
        })
        .collect::<Vec<_>>();
    drop(map);

    let frame = WsFrame::Presence(WsPresencePayload {
        session_id: session_id.to_string(),
        devices,
    });
    send_to_session_devices(state, session_id, &frame);
}

async fn handle_message(
    state: &RelayState,
    sender: &TokenPayload,
    mut envelope: Envelope,
) -> Result<(), String> {
    if envelope.id.trim().is_empty() || envelope.target.trim().is_empty() || envelope.kind.trim().is_empty() {
        return Err("invalid message".to_string());
    }
    envelope.source = sender.device_id.clone();
    envelope.session_id = sender.session_id.clone();

    let devices = state.db.get_devices_by_session(&sender.session_id)?;
    let target_ids = resolve_targets(&envelope.target, &sender.device_id, &devices);
    for target in &target_ids {
        send_to_device(state, target, &WsFrame::Message(envelope.clone()));
    }

    if should_persist_type(&envelope.kind) {
        let payload_text = serde_json::to_string(&envelope.payload).unwrap_or_default();
        let row = EncryptedMessageRow {
            id: envelope.id.clone(),
            session_id: envelope.session_id.clone(),
            source: envelope.source.clone(),
            target: envelope.target.clone(),
            kind: envelope.kind.clone(),
            seq: envelope.seq,
            ts: envelope.ts,
            payload: payload_text,
        };
        let _ = state.db.save_encrypted_message(row);
    }
    if let Some(content) = envelope
        .payload
        .get("content")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        let _ = state
            .db
            .save_message(&envelope.session_id, &sender.role, content);
    }

    if should_queue_ack_by_type(&envelope.kind) {
        if let Some(target_id) = target_ids.get(0).filter(|_| target_ids.len() == 1) {
            let _ = state.db.queue_delivery(
                &envelope.id,
                &envelope.session_id,
                &sender.device_id,
                target_id,
            );
        } else {
            let rows = target_ids
                .iter()
                .map(|target_id| DeliveryRow {
                    message_id: envelope.id.clone(),
                    session_id: envelope.session_id.clone(),
                    source_device_id: sender.device_id.clone(),
                    target_device_id: target_id.clone(),
                })
                .collect::<Vec<_>>();
            let _ = state.db.queue_deliveries_batch(&rows);
        }
        if !target_ids.is_empty() {
            track_ack_expectations(state, &envelope.id, &target_ids, now_millis() as u64);
        }
    }
    Ok(())
}

async fn handle_ack(
    state: Arc<RelayState>,
    sender: &TokenPayload,
    mut ack: AckMessage,
) -> Result<(), String> {
    if ack.message_id.trim().is_empty() {
        return Err("invalid ack".to_string());
    }
    ack.source = sender.device_id.clone();
    ack.session_id = sender.session_id.clone();
    let ack_state = ack.state.clone();
    if ack_state != Some(super::protocol::AckState::RetryAfter) {
        enqueue_ack_mark(Arc::clone(&state), &ack.message_id, &sender.device_id);
        remember_recent_ack(&state, &sender.device_id, &ack.message_id);
    }
    if let Some(state_value) = ack_state {
        observe_ack_rtt(&state, &ack.message_id, &sender.device_id, state_value, now_millis() as u64);
    }
    let frame = WsFrame::Ack(ack);
    send_to_session_peers(&state, &sender.session_id, &sender.device_id, &frame);
    Ok(())
}

fn resolve_targets(target: &str, source_device_id: &str, devices: &[super::db::DeviceRow]) -> Vec<String> {
    if target.is_empty() {
        return Vec::new();
    }
    if target == "broadcast" {
        return devices
            .iter()
            .filter(|d| is_valid_role(&d.role))
            .map(|d| d.id.clone())
            .filter(|id| id != source_device_id)
            .collect();
    }
    if target == source_device_id {
        return Vec::new();
    }
    vec![target.to_string()]
}

fn is_valid_role(role: &str) -> bool {
    matches!(role, "agent" | "app")
}

fn send_to_device(state: &RelayState, device_id: &str, frame: &WsFrame) {
    let senders = state.senders.lock().unwrap();
    if let Some(list) = senders.get(device_id) {
        for sender in list.values() {
            let _ = sender.send(frame.clone());
        }
    }
}

fn send_to_session_devices(state: &RelayState, session_id: &str, frame: &WsFrame) {
    let map = state.online_devices.lock().unwrap();
    let mut targets = Vec::new();
    for (key, devices) in map.iter() {
        if !key.ends_with(&format!(":{session_id}")) {
            continue;
        }
        for device_id in devices.keys() {
            targets.push(device_id.clone());
        }
    }
    drop(map);
    for device_id in targets {
        send_to_device(state, &device_id, frame);
    }
}

fn send_to_session_peers(state: &RelayState, session_id: &str, source_device_id: &str, frame: &WsFrame) {
    let map = state.online_devices.lock().unwrap();
    let mut targets = Vec::new();
    for (key, devices) in map.iter() {
        if !key.ends_with(&format!(":{session_id}")) {
            continue;
        }
        for device_id in devices.keys() {
            if device_id == source_device_id {
                continue;
            }
            targets.push(device_id.clone());
        }
    }
    drop(map);
    for device_id in targets {
        send_to_device(state, &device_id, frame);
    }
}

async fn send_error(socket: &mut WebSocket, code: &str, message: &str) {
    let frame = WsFrame::Error(WsErrorPayload {
        code: code.to_string(),
        message: message.to_string(),
        retryable: Some(false),
    });
    let _ = socket
        .send(Message::Text(serde_json::to_string(&frame).unwrap_or_default()))
        .await;
    let _ = socket.send(Message::Close(None)).await;
}

struct WsPayload {
    text: String,
    bytes: usize,
    is_text: bool,
}

fn extract_payload(message: Message) -> Option<WsPayload> {
    match message {
        Message::Text(text) => Some(WsPayload {
            bytes: text.len(),
            text,
            is_text: true,
        }),
        Message::Binary(bytes) => Some(WsPayload {
            bytes: bytes.len(),
            text: String::from_utf8_lossy(&bytes).to_string(),
            is_text: false,
        }),
        _ => None,
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionCreateBody {
    namespace: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairCreateBody {
    public_key: Option<String>,
    namespace: Option<String>,
    protocol_version: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairJoinBody {
    code: Option<String>,
    public_key: Option<String>,
    protocol_version: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenRevokeBody {
    token: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushRegisterBody {
    token: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSwitchBody {
    session_id: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionUpdateBody {
    expected_version: Option<i64>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagesQuery {
    after: Option<i64>,
    after_cursor: Option<i64>,
    limit: Option<usize>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueQuery {
    limit: Option<usize>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionsQuery {
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageListItem {
    id: i64,
    session_id: String,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageListResponse {
    messages: Vec<MessageListItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairStatusResponse {
    joined: bool,
    app_public_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedMessageResponse {
    cursor: i64,
    id: String,
    session_id: String,
    source: String,
    target: String,
    #[serde(rename = "type")]
    kind: String,
    seq: i64,
    ts: i64,
    payload: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pty_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagesResponse {
    messages: Vec<EncryptedMessageResponse>,
    count: usize,
    next_cursor: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueResponse {
    messages: Vec<EncryptedMessageResponse>,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionListItem {
    session_id: String,
    role: String,
    first_seen: i64,
    last_seen: i64,
    online_count: usize,
    online_roles: Vec<String>,
    has_agent_online: bool,
    has_app_online: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionListResponse {
    current_session_id: Option<String>,
    sessions: Vec<SessionListItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionLogResponse {
    logs: Vec<ConnectionLogEntry>,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionLogEntry {
    id: i64,
    device_id: String,
    session_id: String,
    role: String,
    ip: Option<String>,
    event: String,
    created_at: String,
}

async fn create_session(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let parsed: SessionCreateBody = parse_json_body(&body).unwrap_or_default();
    let namespace = resolve_request_namespace(&headers, parsed.namespace.as_deref());
    let id = generate_uuid_v4();
    if let Err(err) = state.db.create_session(&id, &namespace) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    (StatusCode::OK, Json(json!({ "id": id, "namespace": namespace })))
}

async fn get_session_messages(
    State(state): State<Arc<RelayState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let rows = match state.db.get_messages(&session_id) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let messages = rows
        .into_iter()
        .map(|row| MessageListItem {
            id: row.id,
            session_id: row.session_id,
            role: row.role,
            content: row.content,
            created_at: row.created_at,
        })
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(serde_json::to_value(MessageListResponse { messages }).unwrap()),
    )
}

async fn pair_create(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let parsed: PairCreateBody = match parse_json_body(&body) {
        Some(value) => value,
        None => return json_error(StatusCode::BAD_REQUEST, "invalid json"),
    };
    let Some(public_key) = parsed.public_key.filter(|value| !value.trim().is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "publicKey required");
    };
    let namespace = resolve_request_namespace(&headers, parsed.namespace.as_deref());
    let client_protocol = resolve_protocol_version(&headers, parsed.protocol_version.as_deref());
    if state.config.require_protocol_version && client_protocol.is_none() {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(json!({
                "error": "protocol version required",
                "serverProtocolVersion": PROTOCOL_VERSION,
            })),
        );
    }
    if let Err(reason) = is_protocol_compatible(client_protocol.as_deref(), PROTOCOL_VERSION) {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(json!({
                "error": "protocol mismatch",
                "detail": reason,
                "serverProtocolVersion": PROTOCOL_VERSION,
            })),
        );
    }
    let ip = resolve_client_ip(&headers);
    if !check_rate_limit(&state, &ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "rate limit exceeded", "retryAfter": 60 })),
        );
    }

    let session_id = generate_uuid_v4();
    if let Err(err) = state.db.create_session(&session_id, &namespace) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    let device_id = generate_device_id();
    let pairing_code = generate_pairing_code();
    let expires_at = (now_millis() + PAIRING_TTL_MS).to_string();
    let session_token = match sign_session_token(
        &state,
        &device_id,
        &session_id,
        "agent",
        &namespace,
    ) {
        Ok(token) => token,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    if let Err(err) = state
        .db
        .add_device(&device_id, &public_key, "agent", &session_id, &session_token)
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    if let Err(err) = state.db.create_pairing_request(
        &pairing_code,
        &session_id,
        &public_key,
        &device_id,
        &session_token,
        &expires_at,
    ) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    (
        StatusCode::OK,
        Json(json!({
            "pairingCode": pairing_code,
            "sessionToken": session_token,
            "deviceId": device_id,
            "sessionId": session_id,
            "namespace": namespace,
            "protocolVersion": PROTOCOL_VERSION,
        })),
    )
}

async fn pair_join(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let parsed: PairJoinBody = match parse_json_body(&body) {
        Some(value) => value,
        None => return json_error(StatusCode::BAD_REQUEST, "invalid json"),
    };
    let Some(code) = parsed.code.filter(|value| !value.trim().is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "code and publicKey required");
    };
    let Some(public_key) = parsed.public_key.filter(|value| !value.trim().is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "code and publicKey required");
    };

    let client_protocol = resolve_protocol_version(&headers, parsed.protocol_version.as_deref());
    if state.config.require_protocol_version && client_protocol.is_none() {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(json!({
                "error": "protocol version required",
                "serverProtocolVersion": PROTOCOL_VERSION,
            })),
        );
    }
    if let Err(reason) = is_protocol_compatible(client_protocol.as_deref(), PROTOCOL_VERSION) {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(json!({
                "error": "protocol mismatch",
                "detail": reason,
                "serverProtocolVersion": PROTOCOL_VERSION,
            })),
        );
    }

    let ip = resolve_client_ip(&headers);
    if !check_rate_limit(&state, &ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "rate limit exceeded", "retryAfter": 60 })),
        );
    }

    let req = match state.db.get_pairing_request(&code) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let Some(req) = req else {
        return json_error(StatusCode::NOT_FOUND, "invalid code");
    };
    if req.code != code {
        return json_error(StatusCode::NOT_FOUND, "invalid code");
    }
    if req.joined {
        return json_error(StatusCode::CONFLICT, "already joined");
    }
    if req.agent_device_id.trim().is_empty() || req.session_token.trim().is_empty() {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "pairing request invalid");
    }
    if pairing_request_expired(&req) {
        return json_error(StatusCode::GONE, "code expired");
    }

    let namespace = state
        .db
        .get_session_namespace(&req.session_id)
        .unwrap_or(None)
        .unwrap_or_else(|| DEFAULT_NAMESPACE.to_string());
    let device_id = generate_device_id();
    let session_token = match sign_session_token(
        &state,
        &device_id,
        &req.session_id,
        "app",
        &namespace,
    ) {
        Ok(token) => token,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    if let Err(err) = state
        .db
        .add_device(&device_id, &public_key, "app", &req.session_id, &session_token)
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    if let Err(err) = state
        .db
        .join_pairing_request(&code, &public_key, &device_id, &session_token)
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }

    (
        StatusCode::OK,
        Json(json!({
            "agentPublicKey": req.agent_public_key,
            "sessionToken": session_token,
            "deviceId": device_id,
            "sessionId": req.session_id,
            "namespace": namespace,
            "protocolVersion": PROTOCOL_VERSION,
        })),
    )
}

async fn pair_status(
    State(state): State<Arc<RelayState>>,
    Path(code): Path<String>,
) -> impl IntoResponse {
    let req = match state.db.get_pairing_request(&code) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let Some(req) = req else {
        return json_error(StatusCode::NOT_FOUND, "not found");
    };
    let joined = req.joined
        && req.app_device_id.as_deref().is_some()
        && req.app_session_token.as_deref().is_some();
    (
        StatusCode::OK,
        Json(serde_json::to_value(PairStatusResponse {
            joined,
            app_public_key: req.app_public_key,
        })
        .unwrap()),
    )
}

async fn token_revoke(
    State(state): State<Arc<RelayState>>,
    body: Bytes,
) -> impl IntoResponse {
    let parsed: TokenRevokeBody = match parse_json_body(&body) {
        Some(value) => value,
        None => return json_error(StatusCode::BAD_REQUEST, "invalid json"),
    };
    let Some(token) = parsed.token.filter(|value| !value.trim().is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "token required");
    };
    if let Err(err) = state.db.revoke_token(&token) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    (StatusCode::OK, Json(json!({ "revoked": true })))
}

async fn token_refresh(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state
        .jwt
        .verify_token_with_leeway(&token, &state.db, TOKEN_REFRESH_GRACE_SECONDS)
    {
        Ok(value) => value,
        Err(_) => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "token invalid or beyond grace period",
            )
        }
    };
    let device = match state.db.get_device_by_token(&token) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    if device.is_none() {
        return json_error(StatusCode::NOT_FOUND, "device not found");
    }
    let new_token = match sign_session_token(
        &state,
        &payload.device_id,
        &payload.session_id,
        &payload.role,
        &payload.namespace,
    ) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    if let Err(err) = state.db.update_device_token(&payload.device_id, &new_token) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    let _ = state.db.revoke_token(&token);
    (StatusCode::OK, Json(json!({ "sessionToken": new_token })))
}

async fn push_register(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let ip = resolve_client_ip(&headers);
    let key = format!("push_register:{ip}");
    if !check_rate_limit(
        &state,
        &key,
        PUSH_REGISTER_RATE_LIMIT_MAX,
        PUSH_REGISTER_RATE_LIMIT_WINDOW_MS,
    ) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": "rate limit exceeded",
                "retryAfter": (PUSH_REGISTER_RATE_LIMIT_WINDOW_MS / 1000),
            })),
        );
    }
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    let device = match state.db.get_device_by_token(&token) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let Some(device) = device else {
        return json_error(StatusCode::NOT_FOUND, "device not found");
    };
    if device.id != payload.device_id {
        return json_error(StatusCode::NOT_FOUND, "device not found");
    }
    let belongs = state
        .db
        .session_belongs_to_namespace(&payload.session_id, &payload.namespace)
        .unwrap_or(false);
    if !belongs {
        return json_error(StatusCode::FORBIDDEN, "namespace mismatch");
    }
    let parsed: PushRegisterBody = match parse_json_body(&body) {
        Some(value) => value,
        None => return json_error(StatusCode::BAD_REQUEST, "invalid json"),
    };
    let Some(fcm_token) = normalize_fcm_token(parsed.token.as_deref()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("token required and max length is {}", FCM_TOKEN_MAX_LENGTH),
            })),
        );
    };
    let _ = state.db.clear_fcm_token_by_value(fcm_token);
    if let Err(err) = state.db.update_fcm_token(&payload.device_id, fcm_token) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }
    let registered = state
        .db
        .get_fcm_tokens_by_session(&payload.session_id, &payload.role)
        .map(|tokens| tokens.iter().any(|token| token == fcm_token))
        .unwrap_or(true);
    (
        StatusCode::OK,
        Json(json!({
            "registered": registered,
            "deviceId": payload.device_id,
            "role": payload.role,
            "sessionId": payload.session_id,
        })),
    )
}

async fn session_messages(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    if payload.session_id != session_id {
        return json_error(StatusCode::FORBIDDEN, "session mismatch");
    }
    let belongs = state
        .db
        .session_belongs_to_namespace(&payload.session_id, &payload.namespace)
        .unwrap_or(false);
    if !belongs {
        return json_error(StatusCode::FORBIDDEN, "namespace mismatch");
    }
    let after_ts = query.after.unwrap_or(0).max(0);
    let after_cursor = query.after_cursor.unwrap_or(0).max(0);
    let limit = normalize_limit(query.limit, 100, 1, 500);
    let rows = match state
        .db
        .get_encrypted_messages(&session_id, after_ts, limit, after_cursor)
    {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let messages = rows
        .iter()
        .map(|row| map_encrypted_message(row))
        .collect::<Vec<_>>();
    let next_cursor = rows.last().map(|row| row.cursor).unwrap_or(after_cursor);
    (
        StatusCode::OK,
        Json(serde_json::to_value(MessagesResponse {
            messages,
            count: rows.len(),
            next_cursor,
        })
        .unwrap()),
    )
}

async fn queue_pending(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    Query(query): Query<QueueQuery>,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    let limit = normalize_limit(query.limit, 100, 1, 500);
    let rows = match state.db.get_pending_deliveries(&payload.device_id, limit) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let mut messages = Vec::new();
    for row in &rows {
        if has_recent_ack(&state, &payload.device_id, &row.id) {
            continue;
        }
        messages.push(map_encrypted_message(&EncryptedMessageCursorRow {
            cursor: 0,
            id: row.id.clone(),
            session_id: row.session_id.clone(),
            source: row.source.clone(),
            target: row.target.clone(),
            kind: row.kind.clone(),
            seq: row.seq,
            ts: row.ts,
            payload: row.payload.clone(),
        }));
    }
    (
        StatusCode::OK,
        Json(serde_json::to_value(QueueResponse {
            count: messages.len(),
            messages,
        })
        .unwrap()),
    )
}

async fn session_list(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    let all_memberships = state
        .db
        .get_session_memberships(&payload.device_id)
        .unwrap_or_default();
    let rows = match state
        .db
        .get_session_memberships_by_namespace(&payload.device_id, &payload.namespace)
    {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let _ = state
        .db
        .touch_session_membership(&payload.device_id, &payload.session_id);
    let online = state.online_devices.lock().unwrap();
    let sessions = rows
        .into_iter()
        .map(|row| {
            let key = format!("{}:{}", payload.namespace, row.session_id);
            let mut online_roles = HashSet::new();
            let mut online_count = 0;
            if let Some(devices) = online.get(&key) {
                online_count = devices.len();
                for presence in devices.values() {
                    online_roles.insert(presence.role.to_string());
                }
            }
            let online_roles = online_roles.into_iter().collect::<Vec<_>>();
            let has_agent_online = online_roles.iter().any(|role| role == "agent");
            let has_app_online = online_roles.iter().any(|role| role == "app");
            SessionListItem {
                session_id: row.session_id,
                role: row.role,
                first_seen: row.first_seen_ts,
                last_seen: row.last_seen_ts,
                online_count,
                online_roles,
                has_agent_online,
                has_app_online,
            }
        })
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(serde_json::to_value(SessionListResponse {
            current_session_id: all_memberships
                .iter()
                .any(|row| row.session_id == payload.session_id)
                .then_some(payload.session_id),
            sessions,
        })
        .unwrap()),
    )
}

async fn session_connections(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(query): Query<ConnectionsQuery>,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    if payload.session_id != session_id {
        return json_error(StatusCode::FORBIDDEN, "session mismatch");
    }
    let belongs = state
        .db
        .session_belongs_to_namespace(&payload.session_id, &payload.namespace)
        .unwrap_or(false);
    if !belongs {
        return json_error(StatusCode::FORBIDDEN, "namespace mismatch");
    }
    let limit = normalize_limit(query.limit, 50, 1, 200);
    let logs = match state.db.get_connection_logs(&session_id, limit) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let rows = logs
        .into_iter()
        .map(map_connection_log)
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(serde_json::to_value(ConnectionLogResponse {
            count: rows.len(),
            logs: rows,
        })
        .unwrap()),
    )
}

async fn session_version(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    if payload.session_id != session_id {
        return json_error(StatusCode::FORBIDDEN, "session mismatch");
    }
    let version = match state
        .db
        .get_session_version(&session_id, Some(&payload.namespace))
    {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let Some(version) = version else {
        return json_error(StatusCode::NOT_FOUND, "session not found");
    };
    (StatusCode::OK, Json(json!({ "version": version })))
}

async fn session_switch(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };

    let parsed: SessionSwitchBody = parse_json_body(&body).unwrap_or_default();
    let requested = parsed
        .session_id
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

    let belongs = state
        .db
        .session_belongs_to_namespace(&payload.session_id, &payload.namespace)
        .unwrap_or(false);
    if !belongs {
        return json_error(StatusCode::FORBIDDEN, "namespace mismatch");
    }
    let room_key = format!("{}:{}", payload.namespace, payload.session_id);
    let online_map = state.online_devices.lock().unwrap();
    let Some(online) = online_map.get(&room_key) else {
        return json_error(StatusCode::CONFLICT, "no online devices");
    };
    if online.is_empty() {
        return json_error(StatusCode::CONFLICT, "no online devices");
    }
    let has_agent = online.values().any(|presence| presence.role == "agent");
    if !has_agent {
        return json_error(StatusCode::CONFLICT, "agent offline");
    }
    drop(online_map);

    let target_session_id = requested.clone().unwrap_or_else(generate_uuid_v4);
    if let Some(requested_id) = requested.as_deref() {
        let exists = state
            .db
            .session_exists(requested_id, Some(&payload.namespace))
            .unwrap_or(false);
        if !exists {
            return json_error(StatusCode::NOT_FOUND, "session not found");
        }
    } else if let Err(err) = state.db.create_session(&target_session_id, &payload.namespace) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
    }

    let devices = match state.db.get_devices_by_session_with_tokens(&payload.session_id) {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    let online_map = state.online_devices.lock().unwrap();
    let online_ids = online_map
        .get(&room_key)
        .map(|map| map.keys().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    drop(online_map);
    let mut tokens = HashMap::new();
    let mut online_devices = Vec::new();
    for device in devices {
        if online_ids.contains(&device.id) {
            online_devices.push(device);
        }
    }
    if online_devices.is_empty() {
        return json_error(StatusCode::CONFLICT, "no online devices in session");
    }
    if !online_devices.iter().any(|device| device.role == "agent") {
        return json_error(StatusCode::CONFLICT, "agent offline");
    }
    for device in online_devices {
        let new_token = match sign_session_token(
            &state,
            &device.id,
            &target_session_id,
            &device.role,
            &payload.namespace,
        ) {
            Ok(value) => value,
            Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
        };
        tokens.insert(device.id.clone(), new_token.clone());
        if let Err(err) = state
            .db
            .update_device_session(&device.id, &target_session_id, &new_token)
        {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err);
        }
        let _ = state
            .db
            .upsert_session_membership(&device.id, &target_session_id, &device.role);
        let _ = state.db.revoke_token(&device.session_token);
    }

    (
        StatusCode::OK,
        Json(json!({ "sessionId": target_session_id, "tokens": tokens })),
    )
}

async fn session_update(
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    body: Bytes,
) -> impl IntoResponse {
    let Some(token) = extract_bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "authorization required");
    };
    let payload = match state.jwt.verify_token(&token, &state.db) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::UNAUTHORIZED, "invalid token"),
    };
    if payload.session_id != session_id {
        return json_error(StatusCode::FORBIDDEN, "session mismatch");
    }
    let parsed: SessionUpdateBody = match parse_json_body(&body) {
        Some(value) => value,
        None => return json_error(StatusCode::BAD_REQUEST, "invalid json"),
    };
    let Some(expected_version) = parsed.expected_version else {
        return json_error(StatusCode::BAD_REQUEST, "expectedVersion required");
    };
    let ok = match state
        .db
        .increment_session_version(&session_id, expected_version, Some(&payload.namespace))
    {
        Ok(value) => value,
        Err(err) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &err),
    };
    if !ok {
        let current = state
            .db
            .get_session_version(&session_id, Some(&payload.namespace))
            .unwrap_or(None);
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "version conflict", "currentVersion": current })),
        );
    }
    (
        StatusCode::OK,
        Json(json!({ "success": true, "newVersion": expected_version + 1 })),
    )
}

fn parse_json_body<T: DeserializeOwned>(body: &Bytes) -> Option<T> {
    if body.is_empty() {
        return None;
    }
    serde_json::from_slice(body).ok()
}

fn resolve_request_namespace(headers: &HeaderMap, body_namespace: Option<&str>) -> String {
    let from_body = body_namespace.and_then(non_empty_str);
    let from_header = header_value(headers, "x-yuanio-namespace").and_then(non_empty_str);
    normalize_namespace(from_body.or(from_header))
}

fn resolve_protocol_version(headers: &HeaderMap, body_version: Option<&str>) -> Option<String> {
    body_version
        .and_then(non_empty_str)
        .map(|value| value.to_string())
        .or_else(|| {
            header_value(headers, "x-yuanio-protocol-version")
                .and_then(non_empty_str)
                .map(|value| value.to_string())
        })
}

fn resolve_client_ip(headers: &HeaderMap) -> String {
    let forwarded = header_value(headers, "x-forwarded-for")
        .and_then(|value| value.split(',').map(|s| s.trim()).find(|s| !s.is_empty()))
        .map(|value| value.to_string());
    forwarded
        .or_else(|| header_value(headers, "x-real-ip").map(|value| value.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn header_value<'a>(headers: &'a HeaderMap, key: &str) -> Option<&'a str> {
    headers.get(key)?.to_str().ok()
}

fn non_empty_str(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = header_value(headers, "authorization")?;
    let trimmed = value.trim();
    let token = trimmed.strip_prefix("Bearer ")?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn normalize_limit(value: Option<usize>, default: usize, min: usize, max: usize) -> usize {
    let raw = value.unwrap_or(default);
    let bounded = raw.max(min);
    bounded.min(max)
}

fn json_error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message })))
}

fn generate_pairing_code() -> String {
    let mut rng = rand::thread_rng();
    let mut part = || rng.gen_range(0..1000);
    format!("{:03}-{:03}", part(), part())
}

fn generate_device_id() -> String {
    generate_uuid_v4()
}

fn generate_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn pairing_request_expired(req: &super::db::PairingRequestRow) -> bool {
    let Ok(expires_at) = req.expires_at.parse::<i64>() else {
        return true;
    };
    now_millis() > expires_at
}

fn sign_session_token(
    state: &RelayState,
    device_id: &str,
    session_id: &str,
    role: &str,
    namespace: &str,
) -> Result<String, String> {
    state.jwt.sign_token(&TokenPayload {
        device_id: device_id.to_string(),
        session_id: session_id.to_string(),
        role: role.to_string(),
        namespace: namespace.to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
    })
}

fn check_rate_limit(state: &RelayState, key: &str, max: usize, window_ms: u64) -> bool {
    let now = now_millis().max(0) as u64;
    let mut map = state.rate_limits.lock().unwrap();
    let entries = map.entry(key.to_string()).or_default();
    entries.retain(|ts| now.saturating_sub(*ts) < window_ms);
    entries.push(now);
    entries.len() <= max
}

fn ack_track_key(message_id: &str, target_device_id: &str) -> String {
    format!("{message_id}::{target_device_id}")
}

fn track_ack_expectations(state: &RelayState, message_id: &str, targets: &[String], recv_at: u64) {
    if message_id.trim().is_empty() || targets.is_empty() {
        return;
    }
    let expires_at = recv_at.saturating_add(ACK_TRACKING_TTL_MS);
    let mut pending = state.ack_pending.lock().unwrap();
    for target in targets {
        pending.insert(
            ack_track_key(message_id, target),
            AckPendingRow {
                recv_at,
                expires_at,
            },
        );
    }
}

fn observe_ack_rtt(
    state: &RelayState,
    message_id: &str,
    source_device_id: &str,
    ack_state: super::protocol::AckState,
    now: u64,
) {
    if ack_state == super::protocol::AckState::RetryAfter {
        return;
    }
    let key = ack_track_key(message_id, source_device_id);
    let pending_row = {
        let mut pending = state.ack_pending.lock().unwrap();
        pending.remove(&key)
    };
    let Some(row) = pending_row else {
        return;
    };
    let rtt = now.saturating_sub(row.recv_at);
    record_ack_rtt(state, rtt);
}

fn record_ack_rtt(state: &RelayState, rtt: u64) {
    state.ack_rtt_last_ms.store(rtt, Ordering::Relaxed);
    loop {
        let current = state.ack_rtt_max_ms.load(Ordering::Relaxed);
        if rtt <= current {
            break;
        }
        if state
            .ack_rtt_max_ms
            .compare_exchange(current, rtt, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            break;
        }
    }
    let mut samples = state.ack_rtt_samples.lock().unwrap();
    samples.push(rtt);
    if samples.len() > ACK_RTT_RING_SIZE {
        samples.remove(0);
    }
}

fn summarize_ack_rtt(state: &RelayState) -> Value {
    let samples = state.ack_rtt_samples.lock().unwrap().clone();
    let pending = state.ack_pending.lock().unwrap().len();
    if samples.is_empty() {
        return json!({
            "count": 0,
            "p50": 0,
            "p95": 0,
            "max": 0,
            "last": 0,
            "pending": pending,
        });
    }
    let mut sorted = samples.clone();
    sorted.sort_unstable();
    let p50 = percentile(&sorted, 0.5);
    let p95 = percentile(&sorted, 0.95);
    let max = state.ack_rtt_max_ms.load(Ordering::Relaxed);
    let last = state.ack_rtt_last_ms.load(Ordering::Relaxed);
    json!({
        "count": sorted.len(),
        "p50": p50,
        "p95": p95,
        "max": max,
        "last": last,
        "pending": pending,
    })
}

fn percentile(sorted: &[u64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0] as f64;
    }
    let rank = (sorted.len() - 1) as f64 * p;
    let low = rank.floor() as usize;
    let high = rank.ceil() as usize;
    if low == high {
        return sorted[low] as f64;
    }
    let weight = rank - low as f64;
    (sorted[low] as f64) * (1.0 - weight) + (sorted[high] as f64) * weight
}

fn sweep_ack_tracking(state: &RelayState) {
    let now = now_millis().max(0) as u64;
    {
        let mut pending = state.ack_pending.lock().unwrap();
        pending.retain(|_, row| row.expires_at > now);
    }
    let mut recent = state.recent_acks.lock().unwrap();
    let device_ids = recent.keys().cloned().collect::<Vec<_>>();
    for device_id in device_ids {
        if let Some(entry) = recent.get_mut(&device_id) {
            prune_recent_acks(entry, now);
            if entry.is_empty() {
                recent.remove(&device_id);
            }
        }
    }
}

fn ack_mark_key(message_id: &str, target_device_id: &str) -> String {
    format!("{message_id}::{target_device_id}")
}

fn enqueue_ack_mark(state: Arc<RelayState>, message_id: &str, target_device_id: &str) {
    if message_id.trim().is_empty() || target_device_id.trim().is_empty() {
        return;
    }
    let key = ack_mark_key(message_id, target_device_id);
    {
        let mut keys = state.ack_mark_keys.lock().unwrap();
        if keys.contains(&key) {
            return;
        }
        keys.insert(key);
    }
    let queue_len = {
        let mut queue = state.ack_mark_queue.lock().unwrap();
        queue.push(PendingAckMark {
            message_id: message_id.to_string(),
            target_device_id: target_device_id.to_string(),
        });
        queue.len()
    };
    let delay = if queue_len >= ACK_MARK_FLUSH_BATCH_SIZE {
        0
    } else {
        ACK_MARK_FLUSH_DELAY_MS
    };
    schedule_ack_mark_flush(state, delay);
}

fn schedule_ack_mark_flush(state: Arc<RelayState>, delay_ms: u64) {
    if state
        .ack_mark_scheduled
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return;
    }
    tokio::spawn(async move {
        flush_ack_marks(Arc::clone(&state), delay_ms).await;
    });
}

async fn flush_ack_marks(state: Arc<RelayState>, delay_ms: u64) {
    if delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }
    loop {
        let batch = {
            let mut queue = state.ack_mark_queue.lock().unwrap();
            if queue.is_empty() {
                Vec::new()
            } else {
                let take = ACK_MARK_FLUSH_BATCH_SIZE.min(queue.len());
                queue.drain(0..take).collect::<Vec<_>>()
            }
        };
        if batch.is_empty() {
            break;
        }
        for row in batch {
            let key = ack_mark_key(&row.message_id, &row.target_device_id);
            {
                let mut keys = state.ack_mark_keys.lock().unwrap();
                keys.remove(&key);
            }
            let _ = state
                .db
                .mark_delivery_acked(&row.message_id, &row.target_device_id);
        }
    }
    state
        .ack_mark_scheduled
        .store(false, Ordering::Release);
    let has_more = { !state.ack_mark_queue.lock().unwrap().is_empty() };
    if has_more {
        schedule_ack_mark_flush(state, ACK_MARK_FLUSH_DELAY_MS);
    }
}

fn remember_recent_ack(state: &RelayState, device_id: &str, message_id: &str) {
    if message_id.trim().is_empty() {
        return;
    }
    let now = now_millis().max(0) as u64;
    let mut map = state.recent_acks.lock().unwrap();
    let entry = map.entry(device_id.to_string()).or_default();
    entry.insert(message_id.to_string(), now + RECENT_ACK_TTL_MS);
    prune_recent_acks(entry, now);
}

fn has_recent_ack(state: &RelayState, device_id: &str, message_id: &str) -> bool {
    if message_id.trim().is_empty() {
        return false;
    }
    let now = now_millis().max(0) as u64;
    let mut map = state.recent_acks.lock().unwrap();
    let Some(entry) = map.get_mut(device_id) else {
        return false;
    };
    let Some(expires_at) = entry.get(message_id).copied() else {
        return false;
    };
    if expires_at <= now {
        entry.remove(message_id);
        if entry.is_empty() {
            map.remove(device_id);
        }
        return false;
    }
    true
}

fn prune_recent_acks(entry: &mut HashMap<String, u64>, now: u64) {
    entry.retain(|_, expires_at| *expires_at > now);
    if entry.len() <= RECENT_ACK_MAX_PER_DEVICE {
        return;
    }
    let mut items = entry.iter().map(|(k, v)| (k.clone(), *v)).collect::<Vec<_>>();
    items.sort_by_key(|item| item.1);
    let drop = entry.len().saturating_sub(RECENT_ACK_MAX_PER_DEVICE);
    for i in 0..drop {
        if let Some((key, _)) = items.get(i) {
            entry.remove(key);
        }
    }
}

fn map_encrypted_message(row: &EncryptedMessageCursorRow) -> EncryptedMessageResponse {
    EncryptedMessageResponse {
        cursor: row.cursor,
        id: row.id.clone(),
        session_id: row.session_id.clone(),
        source: row.source.clone(),
        target: row.target.clone(),
        kind: row.kind.clone(),
        seq: row.seq,
        ts: row.ts,
        payload: row.payload.clone(),
        pty_id: None,
    }
}

fn map_connection_log(row: ConnectionLogRow) -> ConnectionLogEntry {
    ConnectionLogEntry {
        id: row.id,
        device_id: row.device_id,
        session_id: row.session_id,
        role: row.role,
        ip: row.ip,
        event: row.event,
        created_at: row.created_at,
    }
}

fn normalize_fcm_token(value: Option<&str>) -> Option<&str> {
    let value = value.and_then(non_empty_str)?;
    if value.len() > FCM_TOKEN_MAX_LENGTH {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use crate::relay::protocol::AckState;
    use tower::ServiceExt;

    fn test_state() -> Arc<RelayState> {
        let config = RelayConfig {
            port: 0,
            db_path: ":memory:".to_string(),
            db_busy_timeout_ms: 0,
            db_fast_write_mode: false,
            jwt_secret: "x".repeat(32),
            require_protocol_version: false,
            max_payload_bytes: 1024 * 1024,
        };
        let db = RelayDb::new(&config).expect("db");
        let jwt = JwtProvider::new(config.jwt_secret.clone());
        Arc::new(RelayState {
            config,
            db,
            jwt,
            senders: Mutex::new(HashMap::new()),
            online_devices: Mutex::new(HashMap::new()),
            rate_limits: Mutex::new(HashMap::new()),
            recent_acks: Mutex::new(HashMap::new()),
            ack_pending: Mutex::new(HashMap::new()),
            ack_mark_queue: Mutex::new(Vec::new()),
            ack_mark_keys: Mutex::new(HashSet::new()),
            ack_mark_scheduled: AtomicBool::new(false),
            ack_rtt_samples: Mutex::new(Vec::new()),
            ack_rtt_last_ms: AtomicU64::new(0),
            ack_rtt_max_ms: AtomicU64::new(0),
        })
    }

    #[tokio::test]
    async fn sessions_create_returns_ok() {
        let app = build_app(test_state());
        let req = Request::post("/sessions")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn pair_create_requires_public_key() {
        let app = build_app(test_state());
        let req = Request::post("/api/v1/pair/create")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn token_refresh_requires_auth() {
        let app = build_app(test_state());
        let req = Request::post("/api/v1/token/refresh")
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn queue_pending_requires_auth() {
        let app = build_app(test_state());
        let req = Request::get("/api/v1/queue/pending")
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn ack_rtt_tracks_and_clears_pending() {
        let state = test_state();
        let targets = vec!["dev_2".to_string()];
        track_ack_expectations(&state, "msg_1", &targets, 1_000);

        observe_ack_rtt(&state, "msg_1", "dev_2", AckState::Ok, 1_800);

        let pending = state.ack_pending.lock().unwrap();
        assert!(!pending.contains_key(&ack_track_key("msg_1", "dev_2")));
        drop(pending);

        let last = state.ack_rtt_last_ms.load(Ordering::Relaxed);
        let max = state.ack_rtt_max_ms.load(Ordering::Relaxed);
        let samples = state.ack_rtt_samples.lock().unwrap();
        assert_eq!(last, 800);
        assert_eq!(max, 800);
        assert_eq!(samples.len(), 1);
    }

    #[test]
    fn ack_rtt_retry_after_keeps_pending() {
        let state = test_state();
        let targets = vec!["dev_2".to_string()];
        track_ack_expectations(&state, "msg_2", &targets, 2_000);

        observe_ack_rtt(&state, "msg_2", "dev_2", AckState::RetryAfter, 2_500);

        let pending = state.ack_pending.lock().unwrap();
        assert!(pending.contains_key(&ack_track_key("msg_2", "dev_2")));
    }

    #[tokio::test]
    async fn ack_mark_flush_clears_pending_deliveries() {
        let state = test_state();
        state.db.create_session("sess_1", "default").unwrap();
        let row = EncryptedMessageRow {
            id: "msg_1".to_string(),
            session_id: "sess_1".to_string(),
            source: "dev_a".to_string(),
            target: "dev_b".to_string(),
            kind: "prompt".to_string(),
            seq: 1,
            ts: 100,
            payload: "{}".to_string(),
        };
        state.db.save_encrypted_message(row).unwrap();
        state.db
            .queue_delivery("msg_1", "sess_1", "dev_a", "dev_b")
            .unwrap();

        let before = state.db.get_pending_deliveries("dev_b", 10).unwrap();
        assert_eq!(before.len(), 1);

        enqueue_ack_mark(Arc::clone(&state), "msg_1", "dev_b");
        flush_ack_marks(Arc::clone(&state), 0).await;

        let after = state.db.get_pending_deliveries("dev_b", 10).unwrap();
        assert!(after.is_empty());
    }
}

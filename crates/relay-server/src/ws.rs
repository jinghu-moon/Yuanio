use crate::{auth, db::{DeliveryRow, EncryptedMessageRow}, AppState};
use axum::{
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use relay_protocol::{
    normalize_namespace, should_queue_ack_by_type, should_persist_type, AckState, DeviceRole,
    WsErrorPayload, WsFrame, WsHelloPayload, WsPresenceDevice, WsPresencePayload, PROTOCOL_VERSION,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, Mutex};
use tracing::warn;

type DeviceId = String;
type RoomKey = String;
type Sender = mpsc::UnboundedSender<axum::extract::ws::Message>;

#[derive(Debug, Clone, Copy)]
pub(crate) struct WsStats {
    pub rooms: usize,
    pub devices: usize,
    pub connections: usize,
}

#[derive(Clone)]
pub(crate) struct WsHub {
    next_id: Arc<AtomicU64>,
    connections: Arc<Mutex<HashMap<DeviceId, HashMap<u64, Sender>>>>,
    online: Arc<Mutex<HashMap<RoomKey, HashMap<DeviceId, DeviceRole>>>>,
}

impl WsHub {
    pub fn new() -> Self {
        Self {
            next_id: Arc::new(AtomicU64::new(1)),
            connections: Arc::new(Mutex::new(HashMap::new())),
            online: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn register(&self, room_key: &str, device_id: &str, role: DeviceRole, sender: Sender) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        {
            let mut connections = self.connections.lock().await;
            let entry = connections.entry(device_id.to_string()).or_insert_with(HashMap::new);
            entry.insert(id, sender);
        }
        {
            let mut online = self.online.lock().await;
            let room = online.entry(room_key.to_string()).or_insert_with(HashMap::new);
            room.insert(device_id.to_string(), role);
        }
        id
    }

    async fn unregister(&self, room_key: &str, device_id: &str, id: u64) {
        {
            let mut connections = self.connections.lock().await;
            if let Some(device) = connections.get_mut(device_id) {
                device.remove(&id);
                if device.is_empty() {
                    connections.remove(device_id);
                }
            }
        }
        {
            let mut online = self.online.lock().await;
            if let Some(room) = online.get_mut(room_key) {
                room.remove(device_id);
                if room.is_empty() {
                    online.remove(room_key);
                }
            }
        }
    }

    async fn device_ids_in_room(&self, room_key: &str) -> Vec<String> {
        let online = self.online.lock().await;
        online
            .get(room_key)
            .map(|room| room.keys().cloned().collect())
            .unwrap_or_default()
    }

    async fn peer_device_ids(&self, room_key: &str, device_id: &str) -> Vec<String> {
        let online = self.online.lock().await;
        online
            .get(room_key)
            .map(|room| {
                room.keys()
                    .filter(|id| id.as_str() != device_id)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn room_snapshot(&self, room_key: &str) -> HashMap<String, DeviceRole> {
        let online = self.online.lock().await;
        online.get(room_key).cloned().unwrap_or_default()
    }

    pub async fn stats(&self) -> WsStats {
        let connections = self.connections.lock().await;
        let devices = connections.len();
        let connection_count = connections.values().map(|entry| entry.len()).sum();
        drop(connections);
        let online = self.online.lock().await;
        let rooms = online.len();
        WsStats {
            rooms,
            devices,
            connections: connection_count,
        }
    }

    async fn send_to_device(&self, device_id: &str, payload: &str) {
        let connections = self.connections.lock().await;
        let Some(device) = connections.get(device_id) else { return };
        for sender in device.values() {
            let _ = sender.send(axum::extract::ws::Message::Text(payload.to_string()));
        }
    }

    async fn broadcast_presence(&self, room_key: &str, session_id: &str) {
        let devices = {
            let online = self.online.lock().await;
            online
                .get(room_key)
                .map(|room| {
                    room.iter()
                        .map(|(id, role)| WsPresenceDevice {
                            id: id.clone(),
                            role: role.clone(),
                            session_id: session_id.to_string(),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        if devices.is_empty() {
            return;
        }
        let frame = WsFrame::Presence(WsPresencePayload {
            session_id: session_id.to_string(),
            devices,
        });
        if let Ok(text) = serde_json::to_string(&frame) {
            let targets = self.device_ids_in_room(room_key).await;
            for device_id in targets {
                self.send_to_device(&device_id, &text).await;
            }
        }
    }
}

pub async fn ws_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

struct WsConnectionState {
    device_id: String,
    session_id: String,
    namespace: String,
    role: DeviceRole,
}

async fn handle_socket(state: AppState, socket: axum::extract::ws::WebSocket) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let hello = match tokio::time::timeout(Duration::from_secs(10), ws_receiver.next()).await {
        Ok(Some(Ok(message))) => message,
        _ => {
            let _ = tx.send(axum::extract::ws::Message::Close(None));
            return;
        }
    };

    let state_result = match handle_hello(&state, &tx, hello).await {
        Ok(value) => value,
        Err(_) => {
            let _ = tx.send(axum::extract::ws::Message::Close(None));
            return;
        }
    };

    let room_key = format!("{}:{}", state_result.namespace, state_result.session_id);
    let conn_id = state
        .ws
        .register(&room_key, &state_result.device_id, state_result.role.clone(), tx.clone())
        .await;
    state.ws.broadcast_presence(&room_key, &state_result.session_id).await;

    let db = state.db.clone();
    let device_id = state_result.device_id.clone();
    let session_id = state_result.session_id.clone();
    let role = role_to_str(&state_result.role).to_string();
    tokio::task::spawn_blocking(move || {
        let _ = db.upsert_session_membership(&device_id, &session_id, &role);
        let _ = db.log_connection(&device_id, &session_id, &role, None, "connect");
    })
    .await
    .ok();

    while let Some(result) = ws_receiver.next().await {
        let message = match result {
            Ok(value) => value,
            Err(_) => break,
        };
        if let axum::extract::ws::Message::Text(text) = message {
            if let Err(_) = handle_frame(&state, &state_result, &room_key, &text).await {
                let _ = tx.send(axum::extract::ws::Message::Close(None));
                break;
            }
        }
    }

    state.ws.unregister(&room_key, &state_result.device_id, conn_id).await;
    state.ws.broadcast_presence(&room_key, &state_result.session_id).await;
    send_task.abort();

    let db = state.db.clone();
    let device_id = state_result.device_id.clone();
    let session_id = state_result.session_id.clone();
    let role = role_to_str(&state_result.role).to_string();
    tokio::task::spawn_blocking(move || {
        let _ = db.log_connection(&device_id, &session_id, &role, None, "disconnect");
    })
    .await
    .ok();
}

async fn handle_hello(
    state: &AppState,
    tx: &Sender,
    message: axum::extract::ws::Message,
) -> Result<WsConnectionState, ()> {
    let text = match message {
        axum::extract::ws::Message::Text(value) => value,
        axum::extract::ws::Message::Binary(bytes) => String::from_utf8(bytes).map_err(|_| ())?,
        _ => return Err(()),
    };
    let frame: WsFrame = serde_json::from_str(&text).map_err(|_| {
        send_error(tx, "bad_request", "invalid json");
    })?;
    let WsFrame::Hello(payload) = frame else {
        send_error(tx, "bad_request", "hello required");
        return Err(());
    };
    validate_hello(state, tx, payload).await
}

async fn validate_hello(
    state: &AppState,
    tx: &Sender,
    payload: WsHelloPayload,
) -> Result<WsConnectionState, ()> {
    if payload.token.trim().is_empty() {
        send_error(tx, "auth_failed", "token required");
        return Err(());
    }
    if state.config.require_protocol_version && payload.protocol_version.is_none() {
        send_error(tx, "auth_failed", "protocol version required");
        return Err(());
    }
    if let Err(reason) = relay_protocol::is_protocol_compatible(
        payload.protocol_version.as_deref(),
        PROTOCOL_VERSION,
    ) {
        send_error(tx, "auth_failed", &format!("protocol mismatch: {reason}"));
        return Err(());
    }
    let token = payload.token.clone();
    let db = state.db.clone();
    let config = state.config.clone();
    let token_payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token)).await {
        Ok(Ok(value)) => value,
        _ => {
            send_error(tx, "auth_failed", "invalid or expired token");
            return Err(());
        }
    };
    let role = match token_payload.role.as_str() {
        "agent" => DeviceRole::Agent,
        "app" => DeviceRole::App,
        _ => {
            send_error(tx, "auth_failed", "invalid role");
            return Err(());
        }
    };
    let namespace = normalize_namespace(
        payload
            .namespace
            .as_deref()
            .or(Some(token_payload.namespace.as_str())),
    );
    Ok(WsConnectionState {
        device_id: token_payload.device_id,
        session_id: token_payload.session_id,
        role,
        namespace,
    })
}

async fn handle_frame(
    state: &AppState,
    sender: &WsConnectionState,
    room_key: &str,
    text: &str,
) -> Result<(), ()> {
    let frame: WsFrame = serde_json::from_str(text).map_err(|_| ())?;
    match frame {
        WsFrame::Message(mut envelope) => {
            envelope.source = sender.device_id.clone();
            envelope.session_id = sender.session_id.clone();
            if envelope.target.trim().is_empty() {
                envelope.target = "broadcast".to_string();
            }
            let session_id = sender.session_id.clone();
            let db = state.db.clone();
            let device_rows = match tokio::task::spawn_blocking(move || db.get_devices_by_session(&session_id)).await {
                Ok(Ok(rows)) => rows,
                Ok(Err(err)) => {
                    warn!("load session devices failed: {}", err);
                    Vec::new()
                }
                Err(err) => {
                    warn!("load session devices join error: {}", err);
                    Vec::new()
                }
            };
            let fallback_devices = if device_rows.is_empty() {
                state.ws.device_ids_in_room(room_key).await
            } else {
                device_rows.into_iter().map(|row| row.id).collect()
            };
            let targets = resolve_delivery_targets(&envelope.target, &sender.device_id, &fallback_devices);

            let frame_payload = serde_json::to_string(&WsFrame::Message(envelope.clone()));
            if let Ok(payload) = frame_payload {
                for device_id in &targets {
                    state.ws.send_to_device(device_id, &payload).await;
                }
            }

            let message_type = envelope.kind.clone();
            let should_queue_ack = should_queue_ack_by_type(&message_type);
            let should_persist = should_persist_ws(&message_type);
            let payload_text = envelope.payload.as_str().map(|value| value.to_string());
            let message_id = envelope.id.clone();
            let source_device_id = sender.device_id.clone();
            let session_id = sender.session_id.clone();
            let target_rows: Vec<DeliveryRow> = if should_queue_ack {
                targets
                    .iter()
                    .map(|target_device_id| DeliveryRow {
                        message_id: message_id.clone(),
                        session_id: session_id.clone(),
                        source_device_id: source_device_id.clone(),
                        target_device_id: target_device_id.clone(),
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let message_to_persist = if should_persist {
                payload_text.map(|payload| EncryptedMessageRow {
                    id: envelope.id,
                    session_id: session_id.clone(),
                    source: envelope.source,
                    target: envelope.target,
                    message_type: message_type.clone(),
                    seq: envelope.seq,
                    ts: envelope.ts,
                    payload,
                })
            } else {
                None
            };
            if message_to_persist.is_some() || !target_rows.is_empty() {
                let db = state.db.clone();
                let persist = message_to_persist;
                let queue_rows = target_rows;
                let result = tokio::task::spawn_blocking(move || {
                    if let Some(message) = persist {
                        db.save_encrypted_message(&message)?;
                    }
                    if !queue_rows.is_empty() {
                        db.queue_deliveries_batch(&queue_rows)?;
                    }
                    Ok::<(), String>(())
                })
                .await;
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => warn!("persist/queue failed: {}", err),
                    Err(err) => warn!("persist/queue join error: {}", err),
                }
            }
        }
        WsFrame::Ack(mut ack) => {
            ack.source = sender.device_id.clone();
            ack.session_id = sender.session_id.clone();
            if ack.state != Some(AckState::RetryAfter) {
                let db = state.db.clone();
                let message_id = ack.message_id.clone();
                let target_device_id = sender.device_id.clone();
                let _ = tokio::task::spawn_blocking(move || db.mark_delivery_acked(&message_id, &target_device_id))
                    .await;
            }
            if let Ok(payload) = serde_json::to_string(&WsFrame::Ack(ack)) {
                for device_id in state.ws.peer_device_ids(room_key, &sender.device_id).await {
                    state.ws.send_to_device(&device_id, &payload).await;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn send_error(tx: &Sender, code: &str, message: &str) {
    let frame = WsFrame::Error(WsErrorPayload {
        code: code.to_string(),
        message: message.to_string(),
        retryable: Some(false),
    });
    if let Ok(text) = serde_json::to_string(&frame) {
        let _ = tx.send(axum::extract::ws::Message::Text(text));
    }
}

fn resolve_delivery_targets(target: &str, source_device_id: &str, devices: &[String]) -> Vec<String> {
    if target.is_empty() {
        return Vec::new();
    }
    if target == "broadcast" {
        return devices
            .iter()
            .filter(|id| id.as_str() != source_device_id)
            .cloned()
            .collect();
    }
    if target == source_device_id {
        return Vec::new();
    }
    vec![target.to_string()]
}

fn role_to_str(role: &DeviceRole) -> &'static str {
    match role {
        DeviceRole::Agent => "agent",
        DeviceRole::App => "app",
    }
}

fn should_persist_ws(message_type: &str) -> bool {
    if message_type.starts_with("pty_") {
        return false;
    }
    should_persist_type(message_type)
}

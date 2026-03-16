mod auth;
mod config;
mod db;
mod pairing;
mod ws;

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use config::RelayConfig;
use db::{EncryptedMessageCursorRow, RelayDb, SessionMembershipRow, SessionMessageRow, SessionMetaRow};
use relay_protocol::{is_protocol_compatible, normalize_namespace, DEFAULT_NAMESPACE, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::{net::TcpListener, sync::Mutex};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct AppState {
    config: Arc<RelayConfig>,
    db: RelayDb,
    ws: ws::WsHub,
    push_register_limiter: RateLimiter,
}

const DEFAULT_SESSION_IDLE_RECLAIM_MS: u64 = 180_000;
const DEFAULT_SESSION_IDLE_SWEEP_INTERVAL_MS: u64 = 30_000;

#[derive(Debug, Clone)]
struct RateLimitEntry {
    window_start_ms: i64,
    count: u64,
}

#[derive(Clone)]
struct RateLimiter {
    max: u64,
    window_ms: i64,
    entries: Arc<Mutex<HashMap<String, RateLimitEntry>>>,
}

impl RateLimiter {
    fn new(max: u64, window_ms: u64) -> Self {
        Self {
            max,
            window_ms: window_ms as i64,
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn allow(&self, key: &str, now_ms: i64) -> bool {
        let mut entries = self.entries.lock().await;
        let entry = entries.entry(key.to_string()).or_insert(RateLimitEntry {
            window_start_ms: now_ms,
            count: 0,
        });
        if now_ms - entry.window_start_ms >= self.window_ms {
            entry.window_start_ms = now_ms;
            entry.count = 0;
        }
        entry.count += 1;
        entry.count <= self.max
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    config::load_env_files();
    let config = Arc::new(config::load_config()?);
    init_tracing();

    let db = RelayDb::new(&config)?;
    let ws = ws::WsHub::new();
    let push_register_limiter = RateLimiter::new(
        config.push_register_rate_limit_max,
        config.push_register_rate_limit_window_ms,
    );
    let addr = SocketAddr::new(config::parse_host(&config.host), config.port);
    let state = AppState {
        config,
        db,
        ws,
        push_register_limiter,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/relay/state", get(relay_state))
        .route("/sessions", post(session_create))
        .route("/sessions/:id", get(session_get_messages))
        .route("/relay-ws", get(ws::ws_handler))
        .route("/api/v1/pair/create", post(pair_create))
        .route("/api/v1/pair/join", post(pair_join))
        .route("/api/v1/pair/status/:code", get(pair_status))
        .route("/api/v1/token/revoke", post(token_revoke))
        .route("/api/v1/token/refresh", post(token_refresh))
        .route("/api/v1/queue/pending", get(queue_pending))
        .route("/api/v1/push/register", post(push_register))
        .route("/api/v1/sessions/:id/messages", get(session_messages))
        .route("/api/v1/sessions", get(session_list))
        .route("/api/v1/sessions/:id/connections", get(session_connections))
        .route("/api/v1/sessions/:id/version", get(session_version))
        .route("/api/v1/sessions/:id/meta", post(session_meta_update))
        .route("/api/v1/sessions/switch", post(session_switch))
        .route("/api/v1/sessions/:id/update", post(session_update))
        .with_state(state);
    let listener = TcpListener::bind(addr).await?;
    info!("relay-server listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let relay_state = build_relay_state_snapshot(&state, now_ms).await;
    let payload = HealthResponse {
        status: "ok",
        protocol_version: PROTOCOL_VERSION,
        server_now_ms: now_ms,
        relay_state,
        event_loop_lag_ms: MetricStats::empty(),
        ack_rtt_ms: AckStats::empty(),
        fcm: FcmHealth {
            enabled: state.config.fcm_enabled,
            push_register_rate_limit: RateLimit {
                max: state.config.push_register_rate_limit_max,
                window_ms: state.config.push_register_rate_limit_window_ms,
            },
        },
    };
    Json(payload)
}

async fn relay_state(State(state): State<AppState>) -> impl IntoResponse {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let payload = build_relay_state_snapshot(&state, now_ms).await;
    let status = if payload.status == "warming_up" {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    (status, Json(payload))
}

async fn build_relay_state_snapshot(state: &AppState, now_ms: i64) -> RelayStateSnapshot {
    let stats = state.ws.stats().await;
    let runtime = RelayRuntimeState {
        tracked_sessions: stats.rooms,
        active_sessions: stats.rooms,
        warming_up_sessions: 0,
        ready_sessions: stats.rooms,
        idle_sessions: 0,
        active_refs: stats.connections,
        active_devices: stats.devices,
        startup_in_flight: 0,
        reclaimed_sessions: 0,
        retry_after_ms: 0,
        idle_reclaim_ms: DEFAULT_SESSION_IDLE_RECLAIM_MS,
        sweep_interval_ms: DEFAULT_SESSION_IDLE_SWEEP_INTERVAL_MS,
    };
    RelayStateSnapshot {
        status: "ready".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        server_now_ms: now_ms,
        retry_after_ms: 0,
        runtime,
    }
}

fn room_key(namespace: &str, session_id: &str) -> String {
    format!("{}:{}", namespace, session_id)
}

fn role_to_string(role: relay_protocol::DeviceRole) -> String {
    match role {
        relay_protocol::DeviceRole::Agent => "agent".to_string(),
        relay_protocol::DeviceRole::App => "app".to_string(),
    }
}

fn get_client_ip(headers: &HeaderMap) -> String {
    if let Some(value) = headers.get("x-forwarded-for").and_then(|value| value.to_str().ok()) {
        if let Some(first) = value.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(value) = headers.get("x-real-ip").and_then(|value| value.to_str().ok()) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".to_string()
}

fn extract_namespace(headers: &HeaderMap, body_namespace: Option<&str>) -> String {
    let header_value = headers
        .get("x-yuanio-namespace")
        .and_then(|value| value.to_str().ok());
    let selected = body_namespace.or(header_value);
    normalize_namespace(selected)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricStats {
    count: u64,
    p50: u64,
    p95: u64,
    max: u64,
    last: u64,
}

impl MetricStats {
    fn empty() -> Self {
        Self {
            count: 0,
            p50: 0,
            p95: 0,
            max: 0,
            last: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AckStats {
    count: u64,
    p50: u64,
    p95: u64,
    max: u64,
    last: u64,
    pending: u64,
}

impl AckStats {
    fn empty() -> Self {
        Self {
            count: 0,
            p50: 0,
            p95: 0,
            max: 0,
            last: 0,
            pending: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RateLimit {
    max: u64,
    window_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FcmHealth {
    enabled: bool,
    push_register_rate_limit: RateLimit,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayRuntimeState {
    tracked_sessions: usize,
    active_sessions: usize,
    warming_up_sessions: usize,
    ready_sessions: usize,
    idle_sessions: usize,
    active_refs: usize,
    active_devices: usize,
    startup_in_flight: usize,
    reclaimed_sessions: usize,
    retry_after_ms: u64,
    idle_reclaim_ms: u64,
    sweep_interval_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayStateSnapshot {
    status: String,
    protocol_version: String,
    server_now_ms: i64,
    retry_after_ms: u64,
    runtime: RelayRuntimeState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    protocol_version: &'static str,
    server_now_ms: i64,
    relay_state: RelayStateSnapshot,
    event_loop_lag_ms: MetricStats,
    ack_rtt_ms: AckStats,
    fcm: FcmHealth,
}

#[derive(Debug, Deserialize)]
struct SessionCreateRequest {
    namespace: Option<String>,
}

#[derive(Debug, Serialize)]
struct SessionCreateResponse {
    id: String,
    namespace: String,
}

#[derive(Debug, Serialize)]
struct SessionGetMessagesResponse {
    messages: Vec<SessionMessageRow>,
}

async fn session_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let parsed: Option<SessionCreateRequest> = if body.is_empty() {
        None
    } else {
        serde_json::from_slice(&body).ok()
    };
    let namespace = extract_namespace(&headers, parsed.as_ref().and_then(|value| value.namespace.as_deref()));
    let session_id = Uuid::new_v4().to_string();

    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let namespace_for_db = namespace.clone();
    let result = tokio::task::spawn_blocking(move || db.create_session(&session_id_for_db, &namespace_for_db)).await;
    match result {
        Ok(Ok(())) => {
            let response = SessionCreateResponse {
                id: session_id,
                namespace,
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(Err(err)) => {
            warn!("session create db error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
        Err(err) => {
            warn!("session create join error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
    }
}

async fn session_get_messages(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let result = tokio::task::spawn_blocking(move || db.get_messages(&session_id_for_db)).await;
    match result {
        Ok(Ok(messages)) => {
            let response = SessionGetMessagesResponse { messages };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(Err(err)) => {
            warn!("session messages db error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
        Err(err) => {
            warn!("session messages join error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
struct PairCreateRequest {
    #[serde(rename = "publicKey")]
    public_key: Option<String>,
    namespace: Option<String>,
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<String>,
}

#[derive(Debug, Serialize)]
struct PairCreateResponse {
    #[serde(rename = "pairingCode")]
    pairing_code: String,
    #[serde(rename = "sessionToken")]
    session_token: String,
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    namespace: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
}

async fn pair_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PairCreateRequest>,
) -> impl IntoResponse {
    let Some(public_key) = body.public_key.as_ref().filter(|v| !v.trim().is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("publicKey required"))).into_response();
    };

    let namespace = extract_namespace(&headers, body.namespace.as_deref());
    let client_protocol = body
        .protocol_version
        .as_deref()
        .or_else(|| headers.get("x-yuanio-protocol-version").and_then(|value| value.to_str().ok()));
    if state.config.require_protocol_version && client_protocol.is_none() {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(ErrorResponse::with_protocol(
                "protocol version required",
                PROTOCOL_VERSION,
            )),
        )
            .into_response();
    }
    if let Err(reason) = is_protocol_compatible(client_protocol, PROTOCOL_VERSION) {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(ErrorResponse::with_detail(
                "protocol mismatch",
                &reason,
                PROTOCOL_VERSION,
            )),
        )
            .into_response();
    }

    let session_id = Uuid::new_v4().to_string();
    let device_id = pairing::generate_device_id();
    let pairing_code = pairing::generate_pairing_code();
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();

    let token_payload = auth::TokenPayload {
        device_id: device_id.clone(),
        session_id: session_id.clone(),
        role: "agent".to_string(),
        namespace: namespace.clone(),
        protocol_version: PROTOCOL_VERSION.to_string(),
    };
    let session_token = match auth::sign_token(&state.config, &token_payload) {
        Ok(value) => value,
        Err(err) => {
            warn!("sign token failed: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("token failed"))).into_response();
        }
    };

    let db = state.db.clone();
    let public_key = public_key.to_string();
    let session_token_for_db = session_token.clone();
    let session_id_for_db = session_id.clone();
    let namespace_for_db = namespace.clone();
    let device_id_for_db = device_id.clone();
    let pairing_code_for_db = pairing_code.clone();
    let expires_at_for_db = expires_at.clone();
    let db_result = tokio::task::spawn_blocking(move || {
        db.create_session(&session_id_for_db, &namespace_for_db)?;
        db.add_device(
            &device_id_for_db,
            &public_key,
            "agent",
            &session_id_for_db,
            &session_token_for_db,
        )?;
        db.create_pairing_request(
            &pairing_code_for_db,
            &session_id_for_db,
            &public_key,
            &device_id_for_db,
            &session_token_for_db,
            &expires_at_for_db,
        )?;
        Ok::<(), String>(())
    })
    .await;
    match db_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!("pair create db failed: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("pair create join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    }

    let response = PairCreateResponse {
        pairing_code,
        session_token,
        device_id,
        session_id,
        namespace,
        protocol_version: PROTOCOL_VERSION.to_string(),
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Deserialize)]
struct PairJoinRequest {
    code: Option<String>,
    #[serde(rename = "publicKey")]
    public_key: Option<String>,
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<String>,
}

#[derive(Debug, Serialize)]
struct PairJoinResponse {
    #[serde(rename = "agentPublicKey")]
    agent_public_key: String,
    #[serde(rename = "sessionToken")]
    session_token: String,
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    namespace: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
}

async fn pair_join(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PairJoinRequest>,
) -> impl IntoResponse {
    let code = body.code.as_ref().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let public_key = body.public_key.as_ref().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let Some(code) = code else {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("code required"))).into_response();
    };
    let Some(public_key) = public_key else {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("publicKey required"))).into_response();
    };

    let client_protocol = body
        .protocol_version
        .as_deref()
        .or_else(|| headers.get("x-yuanio-protocol-version").and_then(|value| value.to_str().ok()));
    if state.config.require_protocol_version && client_protocol.is_none() {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(ErrorResponse::with_protocol(
                "protocol version required",
                PROTOCOL_VERSION,
            )),
        )
            .into_response();
    }
    if let Err(reason) = is_protocol_compatible(client_protocol, PROTOCOL_VERSION) {
        return (
            StatusCode::UPGRADE_REQUIRED,
            Json(ErrorResponse::with_detail(
                "protocol mismatch",
                &reason,
                PROTOCOL_VERSION,
            )),
        )
            .into_response();
    }

    let db = state.db.clone();
    let code_clone = code.clone();
    let req = match tokio::task::spawn_blocking(move || db.get_pairing_request(&code_clone)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("pair join db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("pair join join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let Some(req) = req else {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("invalid code"))).into_response();
    };
    if req.joined {
        return (StatusCode::CONFLICT, Json(ErrorResponse::new("already joined"))).into_response();
    }
    if pairing::is_expired(&req.expires_at) {
        return (StatusCode::GONE, Json(ErrorResponse::new("code expired"))).into_response();
    }

    let namespace = match {
        let db = state.db.clone();
        let session_id = req.session_id.clone();
        tokio::task::spawn_blocking(move || db.get_session_namespace(&session_id)).await
    } {
        Ok(Ok(Some(ns))) => ns,
        Ok(Ok(None)) => DEFAULT_NAMESPACE.to_string(),
        Ok(Err(err)) => {
            warn!("pair join namespace error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("pair join namespace join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let device_id = pairing::generate_device_id();
    let token_payload = auth::TokenPayload {
        device_id: device_id.clone(),
        session_id: req.session_id.clone(),
        role: "app".to_string(),
        namespace: namespace.clone(),
        protocol_version: PROTOCOL_VERSION.to_string(),
    };
    let session_token = match auth::sign_token(&state.config, &token_payload) {
        Ok(value) => value,
        Err(err) => {
            warn!("sign token failed: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("token failed"))).into_response();
        }
    };

    let db = state.db.clone();
    let public_key_clone = public_key.clone();
    let session_token_for_db = session_token.clone();
    let device_id_for_db = device_id.clone();
    let session_id_for_db = req.session_id.clone();
    let code_for_db = code.clone();
    let db_result = tokio::task::spawn_blocking(move || {
        db.add_device(
            &device_id_for_db,
            &public_key_clone,
            "app",
            &session_id_for_db,
            &session_token_for_db,
        )?;
        db.join_pairing_request(&code_for_db, &public_key_clone, &device_id_for_db, &session_token_for_db)?;
        Ok::<(), String>(())
    })
    .await;
    match db_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!("pair join db failed: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("pair join join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    }

    let response = PairJoinResponse {
        agent_public_key: req.agent_public_key,
        session_token,
        device_id,
        session_id: req.session_id,
        namespace,
        protocol_version: PROTOCOL_VERSION.to_string(),
    };
    (StatusCode::OK, Json(response)).into_response()
}

async fn pair_status(
    State(state): State<AppState>,
    axum::extract::Path(code): axum::extract::Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let req = match tokio::task::spawn_blocking(move || db.get_pairing_request(&code)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("pair status db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("pair status join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let Some(req) = req else {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("not found"))).into_response();
    };

    let response = PairStatusResponse {
        joined: req.joined,
        app_public_key: req.app_public_key,
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Serialize)]
struct PairStatusResponse {
    joined: bool,
    #[serde(rename = "appPublicKey")]
    app_public_key: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    detail: Option<String>,
    #[serde(rename = "serverProtocolVersion")]
    server_protocol_version: Option<String>,
}

impl ErrorResponse {
    fn new(message: &str) -> Self {
        Self {
            error: message.to_string(),
            detail: None,
            server_protocol_version: None,
        }
    }

    fn with_protocol(message: &str, version: &str) -> Self {
        Self {
            error: message.to_string(),
            detail: None,
            server_protocol_version: Some(version.to_string()),
        }
    }

    fn with_detail(message: &str, detail: &str, version: &str) -> Self {
        Self {
            error: message.to_string(),
            detail: Some(detail.to_string()),
            server_protocol_version: Some(version.to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TokenRevokeRequest {
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct TokenRevokeResponse {
    revoked: bool,
}

async fn token_revoke(
    State(state): State<AppState>,
    Json(body): Json<TokenRevokeRequest>,
) -> impl IntoResponse {
    let Some(token) = body.token.as_ref().filter(|v| !v.trim().is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("token required"))).into_response();
    };
    let db = state.db.clone();
    let token = token.to_string();
    let result = tokio::task::spawn_blocking(move || db.revoke_token(&token)).await;
    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(TokenRevokeResponse { revoked: true })).into_response(),
        Ok(Err(err)) => {
            warn!("token revoke db error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
        Err(err) => {
            warn!("token revoke join error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
    }
}

#[derive(Debug, Serialize)]
struct TokenRefreshResponse {
    #[serde(rename = "sessionToken")]
    session_token: String,
}

async fn token_refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let old_token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if old_token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }

    let db = state.db.clone();
    let config = state.config.clone();
    let old_token_for_verify = old_token.clone();
    let token_payload = match tokio::task::spawn_blocking(move || auth::verify_token_for_refresh(&config, &db, &old_token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("token invalid or beyond grace period"))).into_response();
        }
    };

    let db = state.db.clone();
    let old_token_owned = old_token.clone();
    let device = match tokio::task::spawn_blocking(move || db.get_device_by_token(&old_token_owned)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("token refresh db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("token refresh join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let Some(device) = device else {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("device not found"))).into_response();
    };
    if device.id != token_payload.device_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("device mismatch"))).into_response();
    }

    let new_payload = auth::TokenPayload {
        device_id: token_payload.device_id.clone(),
        session_id: token_payload.session_id.clone(),
        role: token_payload.role.clone(),
        namespace: token_payload.namespace.clone(),
        protocol_version: token_payload.protocol_version.clone(),
    };
    let new_token = match auth::sign_token(&state.config, &new_payload) {
        Ok(value) => value,
        Err(err) => {
            warn!("token refresh sign error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("token failed"))).into_response();
        }
    };

    let db = state.db.clone();
    let new_token_for_db = new_token.clone();
    let old_token_for_db = old_token.clone();
    let device_id_for_db = device.id.clone();
    let result = tokio::task::spawn_blocking(move || {
        db.update_device_token(&device_id_for_db, &new_token_for_db)?;
        db.revoke_token(&old_token_for_db)?;
        Ok::<(), String>(())
    })
    .await;
    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(TokenRefreshResponse { session_token: new_token })).into_response(),
        Ok(Err(err)) => {
            warn!("token refresh db error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
        Err(err) => {
            warn!("token refresh join error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
struct QueuePendingQuery {
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
struct QueuePendingResponse {
    messages: Vec<db::EncryptedMessageRow>,
    count: usize,
}

async fn queue_pending(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(query): axum::extract::Query<QueuePendingQuery>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }

    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };

    let limit_raw = query.limit.unwrap_or(100);
    let limit = limit_raw.clamp(1, 500) as usize;
    let db = state.db.clone();
    let device_id = payload.device_id.clone();
    let messages = match tokio::task::spawn_blocking(move || db.get_pending_deliveries(&device_id, limit)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("queue pending db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("queue pending join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let response = QueuePendingResponse {
        count: messages.len(),
        messages,
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Deserialize)]
struct PushRegisterRequest {
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct PushRegisterResponse {
    registered: bool,
    #[serde(rename = "deviceId")]
    device_id: String,
    role: String,
    #[serde(rename = "sessionId")]
    session_id: String,
}

async fn push_register(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PushRegisterRequest>,
) -> impl IntoResponse {
    let ip = get_client_ip(&headers);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let rate_key = format!("push_register:{ip}");
    if !state.push_register_limiter.allow(&rate_key, now_ms).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "rate limit exceeded",
                "retryAfter": state.config.push_register_rate_limit_window_ms / 1000,
            })),
        )
            .into_response();
    }

    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };

    let db = state.db.clone();
    let token_for_device = token.clone();
    let device = match tokio::task::spawn_blocking(move || db.get_device_by_token(&token_for_device)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("push register db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("push register join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let Some(device) = device else {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("device not found"))).into_response();
    };
    if device.id != payload.device_id {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("device not found"))).into_response();
    }

    let db = state.db.clone();
    let session_id = payload.session_id.clone();
    let namespace = payload.namespace.clone();
    let session_ok = match tokio::task::spawn_blocking(move || db.session_belongs_to_namespace(&session_id, &namespace)).await {
        Ok(Ok(value)) => value,
        _ => false,
    };
    if !session_ok {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("namespace mismatch"))).into_response();
    }

    let Some(token_value) = normalize_fcm_token(body.token.as_deref(), state.config.fcm_token_max_length) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(&format!(
                "token required and max length is {}",
                state.config.fcm_token_max_length
            ))),
        )
            .into_response();
    };

    let db = state.db.clone();
    let device_id = payload.device_id.clone();
    let session_id = payload.session_id.clone();
    let role = payload.role.clone();
    let token_for_db = token_value.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _ = db.clear_fcm_token_by_value(&token_for_db);
        db.update_fcm_token(&device_id, &token_for_db)?;
        let registered = db
            .get_fcm_tokens_by_session(&session_id, &role)
            .map(|tokens| tokens.iter().any(|token| token == &token_for_db))
            .unwrap_or(true);
        Ok::<bool, String>(registered)
    })
    .await;
    match result {
        Ok(Ok(registered)) => {
            let response = PushRegisterResponse {
                registered,
                device_id: payload.device_id,
                role: payload.role,
                session_id: payload.session_id,
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(Err(err)) => {
            warn!("push register db error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
        Err(err) => {
            warn!("push register join error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response()
        }
    }
}

fn normalize_fcm_token(token: Option<&str>, max_len: usize) -> Option<String> {
    let raw = token?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.len() > max_len {
        return None;
    }
    Some(raw.to_string())
}

#[derive(Debug, Deserialize)]
struct SessionMessagesQuery {
    after: Option<i64>,
    #[serde(rename = "afterCursor")]
    after_cursor: Option<i64>,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct SessionMessagesResponse {
    messages: Vec<EncryptedMessageCursorRow>,
    count: usize,
    #[serde(rename = "nextCursor")]
    next_cursor: i64,
}

async fn session_messages(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<SessionMessagesQuery>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };
    if payload.session_id != session_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("session mismatch"))).into_response();
    }
    let db = state.db.clone();
    let namespace = normalize_namespace(Some(&payload.namespace));
    let session_id_clone = session_id.clone();
    let belongs = match tokio::task::spawn_blocking(move || db.session_belongs_to_namespace(&session_id_clone, &namespace)).await {
        Ok(Ok(value)) => value,
        _ => false,
    };
    if !belongs {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("namespace mismatch"))).into_response();
    }

    let after_ts = query.after.unwrap_or(0).max(0);
    let after_cursor = query.after_cursor.unwrap_or(0).max(0);
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let messages = match tokio::task::spawn_blocking(move || {
        db.get_encrypted_messages(&session_id_for_db, after_ts, limit, after_cursor)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session messages db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session messages join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let next_cursor = messages
        .last()
        .map(|row| row.cursor)
        .unwrap_or(after_cursor);
    let response = SessionMessagesResponse {
        count: messages.len(),
        messages,
        next_cursor,
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Serialize)]
struct SessionListResponse {
    #[serde(rename = "currentSessionId")]
    current_session_id: String,
    sessions: Vec<SessionSummary>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    project_label: Option<String>,
    project_path_hash: Option<String>,
    last_status: Option<String>,
    pending_approvals: i64,
    has_unread: bool,
    last_message_ts: Option<i64>,
    last_event_type: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Serialize)]
struct SessionSummary {
    #[serde(rename = "sessionId")]
    session_id: String,
    role: String,
    #[serde(rename = "firstSeen")]
    first_seen: i64,
    #[serde(rename = "lastSeen")]
    last_seen: i64,
    #[serde(rename = "onlineCount")]
    online_count: usize,
    #[serde(rename = "onlineRoles")]
    online_roles: Vec<String>,
    #[serde(rename = "hasAgentOnline")]
    has_agent_online: bool,
    #[serde(rename = "hasAppOnline")]
    has_app_online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<SessionMeta>,
}

async fn session_list(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };

    let db = state.db.clone();
    let device_id = payload.device_id.clone();
    let namespace = payload.namespace.clone();
    let rows: Vec<SessionMembershipRow> = match tokio::task::spawn_blocking(move || {
        db.get_session_memberships_by_namespace(&device_id, &namespace)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session list db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session list join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let session_ids = rows
        .iter()
        .map(|row| row.session_id.clone())
        .collect::<Vec<_>>();
    let db = state.db.clone();
    let namespace_for_meta = payload.namespace.clone();
    let meta_map = match tokio::task::spawn_blocking(move || {
        db.get_session_meta_by_session_ids(&session_ids, &namespace_for_meta)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session meta db error: {}", err);
            HashMap::new()
        }
        Err(err) => {
            warn!("session meta join error: {}", err);
            HashMap::new()
        }
    };

    let mut sessions = Vec::new();
    for row in rows {
        let snapshot = state
            .ws
            .room_snapshot(&room_key(&payload.namespace, &row.session_id))
            .await;
        let mut role_set = HashMap::new();
        for role in snapshot.values() {
            role_set.insert(role_to_string(role.clone()), true);
        }
        let mut online_roles: Vec<String> = role_set.keys().cloned().collect();
        online_roles.sort();
        let has_agent_online = role_set.contains_key("agent");
        let has_app_online = role_set.contains_key("app");
        let meta = meta_map.get(&row.session_id).map(|value| SessionMeta {
            project_label: value.project_label.clone(),
            project_path_hash: value.project_path_hash.clone(),
            last_status: value.last_status.clone(),
            pending_approvals: value.pending_approvals,
            has_unread: value.has_unread,
            last_message_ts: value.last_message_ts,
            last_event_type: value.last_event_type.clone(),
            updated_at: value.updated_at_ms,
        });
        sessions.push(SessionSummary {
            session_id: row.session_id,
            role: row.role,
            first_seen: row.first_seen_ts,
            last_seen: row.last_seen_ts,
            online_count: snapshot.len(),
            online_roles,
            has_agent_online,
            has_app_online,
            meta,
        });
    }

    let response = SessionListResponse {
        current_session_id: payload.session_id,
        sessions,
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetaUpdateRequest {
    project_label: Option<String>,
    project_path_hash: Option<String>,
    last_status: Option<String>,
    pending_approvals: Option<i64>,
    has_unread: Option<bool>,
    last_message_ts: Option<i64>,
    last_event_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetaUpdateResponse {
    success: bool,
    meta: SessionMeta,
}

const MAX_PROJECT_LABEL_LEN: usize = 64;
const MAX_PROJECT_HASH_LEN: usize = 128;
const MAX_STATUS_LEN: usize = 32;
const MAX_EVENT_TYPE_LEN: usize = 64;

fn normalize_optional_string(value: Option<String>, max_len: usize) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > max_len {
        return Err(format!("value exceeds max length {}", max_len));
    }
    Ok(Some(trimmed.to_string()))
}

fn merge_last_message_ts(current: Option<i64>, update: Option<i64>) -> Option<i64> {
    match (current, update) {
        (Some(current), Some(update)) => Some(current.max(update)),
        (None, Some(update)) => Some(update),
        (Some(current), None) => Some(current),
        (None, None) => None,
    }
}

async fn session_meta_update(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    Json(body): Json<SessionMetaUpdateRequest>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }

    let has_payload = body.project_label.is_some()
        || body.project_path_hash.is_some()
        || body.last_status.is_some()
        || body.pending_approvals.is_some()
        || body.has_unread.is_some()
        || body.last_message_ts.is_some()
        || body.last_event_type.is_some();
    if !has_payload {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("no meta fields provided")))
            .into_response();
    }

    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };
    if payload.session_id != session_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("session mismatch"))).into_response();
    }

    let db = state.db.clone();
    let namespace = payload.namespace.clone();
    let session_id_for_check = session_id.clone();
    let namespace_for_check = namespace.clone();
    let session_ok = match tokio::task::spawn_blocking(move || {
        db.session_belongs_to_namespace(&session_id_for_check, &namespace_for_check)
    })
    .await
    {
        Ok(Ok(value)) => value,
        _ => false,
    };
    if !session_ok {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("namespace mismatch"))).into_response();
    }

    let project_label = match normalize_optional_string(body.project_label, MAX_PROJECT_LABEL_LEN) {
        Ok(value) => value,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new(&err))).into_response(),
    };
    let project_path_hash = match normalize_optional_string(body.project_path_hash, MAX_PROJECT_HASH_LEN) {
        Ok(value) => value,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new(&err))).into_response(),
    };
    let last_status = match normalize_optional_string(body.last_status, MAX_STATUS_LEN) {
        Ok(value) => value,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new(&err))).into_response(),
    };
    let last_event_type = match normalize_optional_string(body.last_event_type, MAX_EVENT_TYPE_LEN) {
        Ok(value) => value,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new(&err))).into_response(),
    };

    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let namespace_for_db = namespace.clone();
    let current = match tokio::task::spawn_blocking(move || {
        db.get_session_meta(&session_id_for_db, &namespace_for_db)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session meta load error: {}", err);
            None
        }
        Err(err) => {
            warn!("session meta load join error: {}", err);
            None
        }
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let pending_approvals = body
        .pending_approvals
        .map(|value| value.max(0))
        .unwrap_or_else(|| current.as_ref().map(|meta| meta.pending_approvals).unwrap_or(0));
    let has_unread = body
        .has_unread
        .unwrap_or_else(|| current.as_ref().map(|meta| meta.has_unread).unwrap_or(false));
    let last_message_update = body.last_message_ts.filter(|value| *value >= 0);
    let last_message_ts =
        merge_last_message_ts(current.as_ref().and_then(|meta| meta.last_message_ts), last_message_update);

    let meta_row = SessionMetaRow {
        session_id: session_id.clone(),
        namespace: namespace.clone(),
        project_label: project_label.or_else(|| current.as_ref().and_then(|meta| meta.project_label.clone())),
        project_path_hash: project_path_hash
            .or_else(|| current.as_ref().and_then(|meta| meta.project_path_hash.clone())),
        last_status: last_status.or_else(|| current.as_ref().and_then(|meta| meta.last_status.clone())),
        pending_approvals,
        has_unread,
        last_message_ts,
        last_event_type: last_event_type
            .or_else(|| current.as_ref().and_then(|meta| meta.last_event_type.clone())),
        updated_at_ms: now_ms,
    };

    let db = state.db.clone();
    let meta_for_db = meta_row.clone();
    let result = tokio::task::spawn_blocking(move || db.upsert_session_meta(&meta_for_db)).await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!("session meta update db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session meta update join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let meta = SessionMeta {
        project_label: meta_row.project_label,
        project_path_hash: meta_row.project_path_hash,
        last_status: meta_row.last_status,
        pending_approvals: meta_row.pending_approvals,
        has_unread: meta_row.has_unread,
        last_message_ts: meta_row.last_message_ts,
        last_event_type: meta_row.last_event_type,
        updated_at: meta_row.updated_at_ms,
    };
    (StatusCode::OK, Json(SessionMetaUpdateResponse { success: true, meta })).into_response()
}

#[derive(Debug, Serialize)]
struct SessionConnectionsResponse {
    logs: Vec<db::ConnectionLogRow>,
    count: usize,
}

async fn session_connections(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };
    if payload.session_id != session_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("session mismatch"))).into_response();
    }

    let db = state.db.clone();
    let namespace = payload.namespace.clone();
    let session_id_clone = session_id.clone();
    let belongs = match tokio::task::spawn_blocking(move || db.session_belongs_to_namespace(&session_id_clone, &namespace)).await {
        Ok(Ok(value)) => value,
        _ => false,
    };
    if !belongs {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("namespace mismatch"))).into_response();
    }

    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let logs = match tokio::task::spawn_blocking(move || db.get_connection_logs(&session_id_for_db, 50)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session connections db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session connections join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };

    let response = SessionConnectionsResponse {
        count: logs.len(),
        logs,
    };
    (StatusCode::OK, Json(response)).into_response()
}

#[derive(Debug, Serialize)]
struct SessionVersionResponse {
    version: i64,
}

async fn session_version(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };
    if payload.session_id != session_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("session mismatch"))).into_response();
    }
    let db = state.db.clone();
    let session_id_for_db = session_id.clone();
    let namespace = payload.namespace.clone();
    let version = match tokio::task::spawn_blocking(move || db.get_session_version(&session_id_for_db, &namespace)).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session version db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session version join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let Some(version) = version else {
        return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("session not found"))).into_response();
    };
    (StatusCode::OK, Json(SessionVersionResponse { version })).into_response()
}

#[derive(Debug, Deserialize)]
struct SessionSwitchRequest {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct SessionSwitchResponse {
    #[serde(rename = "sessionId")]
    session_id: String,
    tokens: HashMap<String, String>,
}

async fn session_switch(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<SessionSwitchRequest>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };

    let requested_session_id = body
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let current_session_id = payload.session_id.clone();
    let namespace = payload.namespace.clone();

    let db = state.db.clone();
    let current_session_id_for_db = current_session_id.clone();
    let namespace_for_db = namespace.clone();
    let belongs = match tokio::task::spawn_blocking(move || {
        db.session_belongs_to_namespace(&current_session_id_for_db, &namespace_for_db)
    })
    .await
    {
        Ok(Ok(value)) => value,
        _ => false,
    };
    if !belongs {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("namespace mismatch"))).into_response();
    }

    let online_snapshot = state.ws.room_snapshot(&room_key(&namespace, &current_session_id)).await;
    if online_snapshot.is_empty() {
        return (StatusCode::CONFLICT, Json(ErrorResponse::new("no online devices"))).into_response();
    }

    let target_session_id = if let Some(req) = requested_session_id {
        let db = state.db.clone();
        let req_clone = req.clone();
        let namespace_clone = namespace.clone();
        let exists = match tokio::task::spawn_blocking(move || db.session_exists(&req_clone, &namespace_clone)).await {
            Ok(Ok(value)) => value,
            _ => false,
        };
        if !exists {
            return (StatusCode::NOT_FOUND, Json(ErrorResponse::new("session not found"))).into_response();
        }
        req
    } else {
        let new_session_id = Uuid::new_v4().to_string();
        let db = state.db.clone();
        let namespace_clone = namespace.clone();
        let session_id_clone = new_session_id.clone();
        let result = tokio::task::spawn_blocking(move || db.create_session(&session_id_clone, &namespace_clone)).await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                warn!("session switch create error: {}", err);
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
            }
            Err(err) => {
                warn!("session switch create join error: {}", err);
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
            }
        }
        new_session_id
    };

    let online_ids: Vec<String> = online_snapshot.keys().cloned().collect();
    let db = state.db.clone();
    let current_session_id_for_db = current_session_id.clone();
    let devices = match tokio::task::spawn_blocking(move || {
        db.get_devices_by_session_with_tokens(&current_session_id_for_db)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session switch devices error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session switch devices join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    let mut filtered = Vec::new();
    for dev in devices {
        if online_ids.contains(&dev.id) {
            filtered.push(dev);
        }
    }
    if filtered.is_empty() {
        return (StatusCode::CONFLICT, Json(ErrorResponse::new("no online devices in session"))).into_response();
    }
    if !filtered.iter().any(|dev| dev.role == "agent") {
        return (StatusCode::CONFLICT, Json(ErrorResponse::new("agent offline"))).into_response();
    }

    let mut tokens = HashMap::new();
    let mut updates: Vec<(String, String, String, String)> = Vec::new();
    for dev in filtered {
        let new_token = match auth::sign_token(
            &state.config,
            &auth::TokenPayload {
                device_id: dev.id.clone(),
                session_id: target_session_id.clone(),
                role: dev.role.clone(),
                namespace: namespace.clone(),
                protocol_version: PROTOCOL_VERSION.to_string(),
            },
        ) {
            Ok(value) => value,
            Err(err) => {
                warn!("session switch sign error: {}", err);
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("token failed"))).into_response();
            }
        };
        tokens.insert(dev.id.clone(), new_token.clone());
        updates.push((dev.id.clone(), new_token, dev.session_token, dev.role));
    }

    let db = state.db.clone();
    let target_session_id_for_db = target_session_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        for (device_id, new_token, old_token, role) in updates {
            db.update_device_session(&device_id, &target_session_id_for_db, &new_token)?;
            db.upsert_session_membership(&device_id, &target_session_id_for_db, &role)?;
            db.revoke_token(&old_token)?;
        }
        Ok::<(), String>(())
    })
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!("session switch db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session switch join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    }

    (StatusCode::OK, Json(SessionSwitchResponse { session_id: target_session_id, tokens })).into_response()
}

#[derive(Debug, Deserialize)]
struct SessionUpdateRequest {
    #[serde(rename = "expectedVersion")]
    expected_version: Option<i64>,
}

#[derive(Debug, Serialize)]
struct SessionUpdateResponse {
    success: bool,
    #[serde(rename = "newVersion")]
    new_version: i64,
}

async fn session_update(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    Json(body): Json<SessionUpdateRequest>,
) -> impl IntoResponse {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !auth_header.starts_with("Bearer ") {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let token = auth_header.trim_start_matches("Bearer ").trim().to_string();
    if token.is_empty() {
        return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("authorization required"))).into_response();
    }
    let config = state.config.clone();
    let db = state.db.clone();
    let token_for_verify = token.clone();
    let payload = match tokio::task::spawn_blocking(move || auth::verify_token(&config, &db, &token_for_verify)).await {
        Ok(Ok(value)) => value,
        _ => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse::new("invalid token"))).into_response();
        }
    };
    if payload.session_id != session_id {
        return (StatusCode::FORBIDDEN, Json(ErrorResponse::new("session mismatch"))).into_response();
    }

    let expected_version = match body.expected_version {
        Some(value) => value,
        None => {
            return (StatusCode::BAD_REQUEST, Json(ErrorResponse::new("expectedVersion required"))).into_response();
        }
    };

    let db = state.db.clone();
    let namespace = payload.namespace.clone();
    let session_id_for_db = session_id.clone();
    let ok = match tokio::task::spawn_blocking(move || {
        db.increment_session_version(&session_id_for_db, expected_version, &namespace)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            warn!("session update db error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
        Err(err) => {
            warn!("session update join error: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new("db error"))).into_response();
        }
    };
    if !ok {
        let db = state.db.clone();
        let namespace = payload.namespace.clone();
        let session_id_for_db = session_id.clone();
        let current = match tokio::task::spawn_blocking(move || db.get_session_version(&session_id_for_db, &namespace)).await {
            Ok(Ok(value)) => value,
            _ => None,
        };
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "version conflict",
                "currentVersion": current,
            })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(SessionUpdateResponse {
            success: true,
            new_version: expected_version + 1,
        }),
    )
        .into_response()
}

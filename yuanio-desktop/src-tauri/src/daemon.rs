use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;

use crate::daemon_state::{remove_state_file, write_state, DaemonState};
use crate::keystore::load_keys;
use crate::resolve_repo_root;
use crate::skills::SkillLogItem;

const SKILL_AUDIT_MAX: usize = 300;
const SESSION_TTL_MIN_MS: u64 = 60_000;
const SESSION_TTL_DEFAULT_MS: u64 = 60 * 60 * 1000;
const MAX_SCAN_NODES_MIN: usize = 500;
const MAX_SCAN_NODES_DEFAULT: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub source: String,
    pub disable_model_invocation: bool,
    pub user_invocable: bool,
    pub context: String,
    pub allowed_tools: Vec<String>,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCandidate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub valid: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallPrepareResponse {
    pub install_id: String,
    pub source: String,
    pub source_kind: String,
    pub scope: String,
    pub created_at: u64,
    pub candidates: Vec<SkillInstallCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallStatusResponse {
    pub install_id: String,
    pub state: String,
    pub source: String,
    pub source_kind: String,
    pub scope: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub candidate_count: u32,
    pub candidates: Vec<SkillInstallCandidate>,
    pub result: Option<SkillInstallCommitResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCommitRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub target_path: String,
    pub warning: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCommitResponse {
    pub install_id: String,
    pub scope: String,
    pub target_root: String,
    pub installed: Vec<SkillInstallCommitRecord>,
    pub skipped: Vec<SkillInstallCommitRecord>,
    pub failed: Vec<SkillInstallCommitRecord>,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCancelResponse {
    pub install_id: String,
    pub cancelled: bool,
    pub existed: bool,
}

#[derive(Debug, Clone)]
pub struct SkillInstallCommitInput {
    pub install_id: String,
    pub selected: Vec<String>,
    pub conflict_policy: Option<String>,
    pub force: bool,
    pub cwd: String,
    pub home: String,
}

#[derive(Debug)]
pub struct SkillInstallError {
    pub code: String,
    pub message: String,
    pub status: u16,
}

#[derive(Debug, Clone)]
struct SkillFile {
    frontmatter: HashMap<String, String>,
    body: String,
}

pub struct SkillEngine;

impl SkillEngine {
    pub fn discover_skills(cwd: &Path, home: &Path) -> Vec<SkillMeta> {
        let roots = vec![
            (cwd.join(".agents").join("skills"), "project", ".agents"),
            (cwd.join(".claude").join("skills"), "project", ".claude"),
            (home.join(".agents").join("skills"), "user", ".agents"),
            (home.join(".claude").join("skills"), "user", ".claude"),
        ];
        let mut all = Vec::new();
        for (dir, scope, source) in roots {
            all.extend(find_skills_in_root(&dir, scope, source));
        }
        dedup_by_priority(all)
    }

    pub fn build_prompt_by_name(name: &str, args: &str, cwd: &Path) -> Option<(SkillMeta, String)> {
        let home = resolve_home();
        let skills = Self::discover_skills(cwd, &home);
        let hit = skills.iter().find(|item| item.name.eq_ignore_ascii_case(name.trim()))?;
        let parsed = parse_skill_file(Path::new(&hit.path))?;
        let rendered = render_skill_args_template(&parsed.body, args.trim());
        Some((hit.clone(), rendered.trim().to_string()))
    }
}

#[derive(Debug, Clone)]
struct SkillInstallCandidateInternal {
    data: SkillInstallCandidate,
    source_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct SkillInstallSession {
    install_id: String,
    source: String,
    source_kind: String,
    scope: String,
    state: String,
    created_at: u64,
    updated_at: u64,
    candidates: Vec<SkillInstallCandidateInternal>,
    cleanup_dirs: Vec<PathBuf>,
    result: Option<SkillInstallCommitResponse>,
}

impl SkillInstallSession {
    fn to_status(&self) -> SkillInstallStatusResponse {
        SkillInstallStatusResponse {
            install_id: self.install_id.clone(),
            state: self.state.clone(),
            source: self.source.clone(),
            source_kind: self.source_kind.clone(),
            scope: self.scope.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            candidate_count: self.candidates.len() as u32,
            candidates: self.candidates.iter().map(|item| item.data.clone()).collect(),
            result: self.result.clone(),
        }
    }
}

pub struct SkillInstallEngine {
    sessions: HashMap<String, SkillInstallSession>,
}

impl SkillInstallEngine {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn prepare(
        &mut self,
        source: &str,
        scope: Option<&str>,
        cwd: &Path,
        _home: &Path,
    ) -> Result<SkillInstallPrepareResponse, SkillInstallError> {
        self.cleanup_expired_sessions();
        let source = source.trim();
        if source.is_empty() {
            return Err(skill_install_error("SKILL_INSTALL_SOURCE_REQUIRED", "source is required", 400));
        }
        let scope = normalize_scope(scope);
        let (source_kind, source_root, cleanup_dirs) = resolve_source_root(source, cwd)?;
        let candidates = scan_skill_candidates(&source_root, &scope, max_scan_nodes());
        let install_id = random_id("install");
        let now = now_ms();

        let session = SkillInstallSession {
            install_id: install_id.clone(),
            source: source.to_string(),
            source_kind: source_kind.clone(),
            scope: scope.clone(),
            state: "prepared".to_string(),
            created_at: now,
            updated_at: now,
            candidates: candidates.clone(),
            cleanup_dirs,
            result: None,
        };
        self.sessions.insert(install_id.clone(), session);

        Ok(SkillInstallPrepareResponse {
            install_id,
            source: source.to_string(),
            source_kind,
            scope,
            created_at: now,
            candidates: candidates.into_iter().map(|item| item.data).collect(),
        })
    }

    pub fn status(&mut self, install_id: &str) -> Option<SkillInstallStatusResponse> {
        self.cleanup_expired_sessions();
        let id = install_id.trim();
        let session = self.sessions.get_mut(id)?;
        session.updated_at = now_ms();
        Some(session.to_status())
    }

    pub fn commit(&mut self, input: SkillInstallCommitInput) -> Result<SkillInstallCommitResponse, SkillInstallError> {
        self.cleanup_expired_sessions();
        let install_id = input.install_id.trim();
        if install_id.is_empty() {
            return Err(skill_install_error("SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required", 400));
        }
        let session = match self.sessions.get_mut(install_id) {
            Some(value) => value,
            None => {
                return Err(skill_install_error(
                    "SKILL_INSTALL_SESSION_NOT_FOUND",
                    &format!("install session not found: {install_id}"),
                    404,
                ));
            }
        };
        if session.state != "prepared" {
            return Err(skill_install_error(
                "SKILL_INSTALL_SESSION_NOT_PREPARED",
                &format!("install session not prepared: {install_id}"),
                409,
            ));
        }

        let selectors = normalize_selected(&input.selected);
        let selected = select_candidates(&session.candidates, &selectors);
        if selected.is_empty() {
            return Err(skill_install_error("SKILL_INSTALL_SELECTION_EMPTY", "no skill candidate selected", 400));
        }

        let conflict_policy = normalize_conflict_policy(input.conflict_policy.as_deref(), input.force);
        let target_root = resolve_install_target_root(&session.scope, &input.cwd, &input.home);
        if let Err(err) = fs::create_dir_all(&target_root) {
            return Err(skill_install_error("SKILL_INSTALL_INTERNAL", &format!("mkdir failed: {err}"), 500));
        }

        let mut installed = Vec::new();
        let mut skipped = Vec::new();
        let mut failed = Vec::new();

        let total = selected.len() as u32;
        for candidate in selected {
            let base = SkillInstallCommitRecord {
                id: candidate.data.id.clone(),
                name: candidate.data.name.clone(),
                path: candidate.data.path.clone(),
                target_path: target_root
                    .join(sanitize_skill_dir_name(&candidate.data.name))
                    .to_string_lossy()
                    .to_string(),
                warning: None,
                error: None,
            };
            if !candidate.data.valid {
                failed.push(SkillInstallCommitRecord {
                    error: Some("candidate invalid".to_string()),
                    ..base
                });
                continue;
            }

            match install_candidate_atomically(&candidate, &target_root, &conflict_policy) {
                Ok(InstallOutcome::Installed { target_path }) => installed.push(SkillInstallCommitRecord {
                    target_path,
                    ..base
                }),
                Ok(InstallOutcome::Skipped { target_path, warning }) => skipped.push(SkillInstallCommitRecord {
                    target_path,
                    warning: Some(warning),
                    ..base
                }),
                Err(err) => failed.push(SkillInstallCommitRecord {
                    error: Some(err),
                    ..base
                }),
            }
        }

        let result = SkillInstallCommitResponse {
            install_id: install_id.to_string(),
            scope: session.scope.clone(),
            target_root: target_root.to_string_lossy().to_string(),
            total,
            installed,
            skipped,
            failed,
        };

        session.state = "committed".to_string();
        session.updated_at = now_ms();
        session.result = Some(result.clone());
        Ok(result)
    }

    pub fn cancel(&mut self, install_id: &str) -> SkillInstallCancelResponse {
        self.cleanup_expired_sessions();
        let id = install_id.trim();
        if id.is_empty() {
            return SkillInstallCancelResponse {
                install_id: id.to_string(),
                cancelled: true,
                existed: false,
            };
        }
        let Some(session) = self.sessions.remove(id) else {
            return SkillInstallCancelResponse {
                install_id: id.to_string(),
                cancelled: true,
                existed: false,
            };
        };
        for dir in session.cleanup_dirs {
            let _ = fs::remove_dir_all(dir);
        }
        SkillInstallCancelResponse {
            install_id: id.to_string(),
            cancelled: true,
            existed: true,
        }
    }

    fn cleanup_expired_sessions(&mut self) {
        let deadline = now_ms().saturating_sub(session_ttl_ms());
        let expired: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(id, session)| {
                if session.updated_at < deadline {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();
        for id in expired {
            if let Some(session) = self.sessions.remove(&id) {
                for dir in session.cleanup_dirs {
                    let _ = fs::remove_dir_all(dir);
                }
            }
        }
    }
}

enum InstallOutcome {
    Installed { target_path: String },
    Skipped { target_path: String, warning: String },
}

pub struct DaemonServerHandle {
    shutdown_tx: oneshot::Sender<()>,
    join: std::thread::JoinHandle<()>,
    pub port: u16,
}

impl DaemonServerHandle {
    pub fn stop(self) {
        let _ = self.shutdown_tx.send(());
        let _ = self.join.join();
    }
}

pub struct DaemonServer;

impl DaemonServer {
    pub fn spawn() -> Result<DaemonServerHandle, String> {
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
        let state = Arc::new(DaemonRuntime::new()?);

        let join = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("daemon runtime");
            runtime.block_on(start_server(state, shutdown_rx, ready_tx));
        });

        let port = ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "daemon 启动超时".to_string())??;

        Ok(DaemonServerHandle { shutdown_tx, join, port })
    }
}

struct DaemonRuntime {
    started_at_ms: u64,
    logs: Mutex<VecDeque<SkillLogItem>>,
    log_seq: AtomicU64,
    install_engine: Mutex<SkillInstallEngine>,
    cwd: PathBuf,
    home: PathBuf,
}

impl DaemonRuntime {
    fn new() -> Result<Self, String> {
        let cwd = resolve_repo_root();
        let home = resolve_home();
        Ok(Self {
            started_at_ms: now_ms(),
            logs: Mutex::new(VecDeque::new()),
            log_seq: AtomicU64::new(1),
            install_engine: Mutex::new(SkillInstallEngine::new()),
            cwd,
            home,
        })
    }

    fn push_log(&self, level: &str, action: &str, message: &str) {
        let mut logs = self.logs.lock().unwrap_or_else(|e| e.into_inner());
        let id = self.log_seq.fetch_add(1, Ordering::Relaxed);
        logs.push_back(SkillLogItem {
            id: format!("log_{id}"),
            at: now_ms(),
            level: level.to_string(),
            action: action.to_string(),
            message: message.to_string(),
        });
        while logs.len() > SKILL_AUDIT_MAX {
            logs.pop_front();
        }
    }
}

async fn start_server(
    state: Arc<DaemonRuntime>,
    shutdown_rx: oneshot::Receiver<()>,
    ready_tx: std::sync::mpsc::Sender<Result<u16, String>>,
) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(value) => value,
        Err(err) => {
            let _ = ready_tx.send(Err(format!("daemon bind 失败: {err}")));
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(err) => {
            let _ = ready_tx.send(Err(format!("daemon 端口读取失败: {err}")));
            return;
        }
    };

    if let Err(err) = write_daemon_state(port) {
        let _ = ready_tx.send(Err(err));
        return;
    }
    let _ = ready_tx.send(Ok(port));

    let app = build_app(state);
    let _ = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await;
    let _ = remove_state_file();
}

fn build_app(state: Arc<DaemonRuntime>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/skills/list", get(skills_list_handler))
        .route("/skills/logs", get(skills_logs_handler))
        .route("/skills/install/prepare", post(skills_install_prepare_handler))
        .route("/skills/install/status", get(skills_install_status_query))
        .route("/skills/install/status/:install_id", get(skills_install_status_path))
        .route("/skills/install/commit", post(skills_install_commit_handler))
        .route("/skills/install/cancel", post(skills_install_cancel_handler))
        .route("/skills/dry-run", post(skills_dry_run_handler))
        .with_state(state)
}

async fn health_handler(State(state): State<Arc<DaemonRuntime>>) -> impl IntoResponse {
    let uptime = now_ms().saturating_sub(state.started_at_ms) / 1000;
    Json(json!({
        "status": "ok",
        "pid": std::process::id(),
        "uptime": uptime,
    }))
}

#[derive(Deserialize)]
struct SkillsListQuery {
    scope: Option<String>,
}

async fn skills_list_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Query(params): Query<SkillsListQuery>,
) -> impl IntoResponse {
    let scope = params.scope.unwrap_or_else(|| "all".to_string()).to_lowercase();
    let mut items = SkillEngine::discover_skills(&state.cwd, &state.home);
    if scope == "project" {
        items.retain(|item| item.scope == "project");
    } else if scope == "user" {
        items.retain(|item| item.scope == "user");
    }
    Json(json!({ "items": items }))
}

#[derive(Deserialize)]
struct SkillsLogsQuery {
    limit: Option<u16>,
}

async fn skills_logs_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Query(params): Query<SkillsLogsQuery>,
) -> impl IntoResponse {
    let limit = clamp_limit(params.limit.unwrap_or(20) as usize, 200);
    let logs = state.logs.lock().unwrap_or_else(|e| e.into_inner());
    let items: Vec<SkillLogItem> = logs.iter().rev().take(limit).cloned().collect();
    Json(json!({ "items": items }))
}

#[derive(Deserialize)]
struct SkillInstallPreparePayload {
    source: String,
    scope: Option<String>,
}

async fn skills_install_prepare_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Json(payload): Json<SkillInstallPreparePayload>,
) -> impl IntoResponse {
    let scope = payload.scope.unwrap_or_else(|| "project".to_string());
    let mut engine = state.install_engine.lock().unwrap_or_else(|e| e.into_inner());
    match engine.prepare(&payload.source, Some(&scope), &state.cwd, &state.home) {
        Ok(resp) => {
            state.push_log("info", "prepare", &format!("prepare success installId={}", resp.install_id));
            (StatusCode::OK, Json(json!(resp)))
        }
        Err(err) => skill_install_error_response(&state, "prepare", err),
    }
}

#[derive(Deserialize)]
struct SkillInstallStatusQuery {
    install_id: Option<String>,
}

async fn skills_install_status_query(
    State(state): State<Arc<DaemonRuntime>>,
    Query(params): Query<SkillInstallStatusQuery>,
) -> impl IntoResponse {
    let Some(install_id) = params.install_id else {
        return skill_api_error(400, "SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required");
    };
    skills_install_status_impl(state, install_id)
}

async fn skills_install_status_path(
    State(state): State<Arc<DaemonRuntime>>,
    AxumPath(install_id): AxumPath<String>,
) -> impl IntoResponse {
    skills_install_status_impl(state, install_id)
}

fn skills_install_status_impl(state: Arc<DaemonRuntime>, install_id: String) -> (StatusCode, Json<Value>) {
    let mut engine = state.install_engine.lock().unwrap_or_else(|e| e.into_inner());
    match engine.status(&install_id) {
        Some(status) => (StatusCode::OK, Json(json!(status))),
        None => skill_api_error(404, "SKILL_INSTALL_SESSION_NOT_FOUND", "install session not found"),
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SelectedInput {
    List(Vec<String>),
    Single(String),
}

#[derive(Deserialize)]
struct SkillInstallCommitPayload {
    install_id: String,
    selected: Option<SelectedInput>,
    force: Option<bool>,
    conflict_policy: Option<String>,
}

async fn skills_install_commit_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Json(payload): Json<SkillInstallCommitPayload>,
) -> impl IntoResponse {
    let selected = match payload.selected {
        Some(SelectedInput::List(list)) => list,
        Some(SelectedInput::Single(raw)) => split_selected(&raw),
        None => Vec::new(),
    };
    let input = SkillInstallCommitInput {
        install_id: payload.install_id,
        selected,
        conflict_policy: payload.conflict_policy,
        force: payload.force.unwrap_or(false),
        cwd: state.cwd.to_string_lossy().to_string(),
        home: state.home.to_string_lossy().to_string(),
    };
    let mut engine = state.install_engine.lock().unwrap_or_else(|e| e.into_inner());
    match engine.commit(input) {
        Ok(resp) => {
            state.push_log("info", "commit", &format!("commit success installId={}", resp.install_id));
            (StatusCode::OK, Json(json!(resp)))
        }
        Err(err) => skill_install_error_response(&state, "commit", err),
    }
}

#[derive(Deserialize)]
struct SkillInstallCancelPayload {
    install_id: String,
}

async fn skills_install_cancel_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Json(payload): Json<SkillInstallCancelPayload>,
) -> impl IntoResponse {
    let mut engine = state.install_engine.lock().unwrap_or_else(|e| e.into_inner());
    let resp = engine.cancel(&payload.install_id);
    state.push_log("info", "cancel", &format!("cancel installId={}", resp.install_id));
    (StatusCode::OK, Json(json!(resp)))
}

#[derive(Deserialize)]
struct SkillDryRunPayload {
    name: String,
    args: Option<String>,
}

async fn skills_dry_run_handler(
    State(state): State<Arc<DaemonRuntime>>,
    Json(payload): Json<SkillDryRunPayload>,
) -> impl IntoResponse {
    let name = payload.name.trim();
    if name.is_empty() {
        return skill_api_error(400, "SKILL_RUN_NAME_REQUIRED", "name is required");
    }
    let args = payload.args.unwrap_or_default();
    let Some((skill, prompt)) = SkillEngine::build_prompt_by_name(name, &args, &state.cwd) else {
        return skill_api_error(404, "SKILL_RUN_NOT_FOUND", &format!("skill not found: {name}"));
    };
    let run_id = random_id("run");
    state.push_log("info", "dry-run", &format!("dry-run success: {name}"));
    (StatusCode::OK, Json(json!({
        "runId": run_id,
        "skill": skill,
        "prompt": prompt,
    })))
}

fn skill_install_error_response(state: &DaemonRuntime, action: &str, err: SkillInstallError) -> (StatusCode, Json<Value>) {
    state.push_log("error", action, &format!("{action} failed: {}", err.message));
    skill_api_error(err.status, &err.code, &err.message)
}

fn skill_api_error(status: u16, code: &str, message: &str) -> (StatusCode, Json<Value>) {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status, Json(json!({ "error": message, "code": code })))
}

fn write_daemon_state(port: u16) -> Result<(), String> {
    let sessions = load_keys().ok().flatten().map(|s| s.keys.session_id).into_iter().collect();
    let state = DaemonState {
        pid: std::process::id(),
        port,
        version: env_version(),
        started_at: now_ms().to_string(),
        sessions,
    };
    write_state(&state)
}

fn env_version() -> String {
    option_env!("CARGO_PKG_VERSION").unwrap_or("0.0.0").to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn clamp_limit(value: usize, max: usize) -> usize {
    let value = if value == 0 { 1 } else { value };
    value.min(max)
}

fn session_ttl_ms() -> u64 {
    let raw = std::env::var("YUANIO_SKILL_INSTALL_SESSION_TTL_MS").ok();
    let parsed = raw.and_then(|v| v.parse::<u64>().ok()).unwrap_or(SESSION_TTL_DEFAULT_MS);
    parsed.max(SESSION_TTL_MIN_MS)
}

fn max_scan_nodes() -> usize {
    let raw = std::env::var("YUANIO_SKILL_INSTALL_SCAN_MAX_NODES").ok();
    let parsed = raw.and_then(|v| v.parse::<usize>().ok()).unwrap_or(MAX_SCAN_NODES_DEFAULT);
    parsed.max(MAX_SCAN_NODES_MIN)
}

fn skill_install_error(code: &str, message: &str, status: u16) -> SkillInstallError {
    SkillInstallError {
        code: code.to_string(),
        message: message.to_string(),
        status,
    }
}

fn normalize_scope(scope: Option<&str>) -> String {
    match scope.map(|s| s.trim().to_lowercase()) {
        Some(value) if value == "user" => "user".to_string(),
        _ => "project".to_string(),
    }
}

fn normalize_conflict_policy(value: Option<&str>, force: bool) -> String {
    if force {
        return "overwrite".to_string();
    }
    match value.map(|s| s.trim().to_lowercase()) {
        Some(value) if value == "overwrite" || value == "rename" || value == "skip" => value,
        _ => "skip".to_string(),
    }
}

fn normalize_selected(raw: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for item in raw {
        let parts = split_selected(item);
        out.extend(parts);
    }
    out.into_iter()
        .map(|item| item.to_lowercase())
        .filter(|item| !item.is_empty())
        .collect()
}

fn split_selected(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .filter_map(|item| {
            let value = item.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            }
        })
        .collect()
}

fn resolve_install_target_root(scope: &str, cwd: &str, home: &str) -> PathBuf {
    let base = if scope == "user" { home } else { cwd };
    Path::new(base).join(".agents").join("skills")
}

fn select_candidates(
    candidates: &[SkillInstallCandidateInternal],
    selectors: &[String],
) -> Vec<SkillInstallCandidateInternal> {
    if selectors.is_empty() || selectors.iter().any(|item| item == "all") {
        return candidates.to_vec();
    }
    let set: std::collections::HashSet<String> = selectors.iter().cloned().collect();
    candidates
        .iter()
        .filter(|candidate| {
            let id = candidate.data.id.to_lowercase();
            let name = candidate.data.name.to_lowercase();
            let path = candidate.data.path.to_lowercase();
            set.contains(&id) || set.contains(&name) || set.contains(&path)
        })
        .cloned()
        .collect()
}

fn resolve_source_root(source: &str, cwd: &Path) -> Result<(String, PathBuf, Vec<PathBuf>), SkillInstallError> {
    if !is_remote_source(source) {
        let source_root = cwd.join(source).canonicalize().map_err(|_| {
            skill_install_error(
                "SKILL_INSTALL_SOURCE_NOT_FOUND",
                &format!("source directory not found: {}", cwd.join(source).to_string_lossy()),
                404,
            )
        })?;
        if !source_root.is_dir() {
            return Err(skill_install_error(
                "SKILL_INSTALL_SOURCE_NOT_FOUND",
                &format!("source directory not found: {}", source_root.to_string_lossy()),
                404,
            ));
        }
        return Ok(("local".to_string(), source_root, Vec::new()));
    }

    let repo_url = normalize_git_source(source);
    let temp_parent = std::env::temp_dir().join(format!("yuanio-skill-src-{}", random_suffix()));
    let clone_target = temp_parent.join("repo");
    fs::create_dir_all(&temp_parent)
        .map_err(|err| skill_install_error("SKILL_INSTALL_INTERNAL", &format!("tmp dir failed: {err}"), 500))?;

    let clone_target_str = clone_target.to_string_lossy().to_string();
    let output = std::process::Command::new("git")
        .args(["clone", "--depth", "1", "--", &repo_url, &clone_target_str])
        .output();
    match output {
        Ok(output) if output.status.success() => Ok(("git".to_string(), clone_target, vec![temp_parent])),
        Ok(output) => {
            let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let reason = if reason.is_empty() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                reason
            };
            let reason = if reason.is_empty() { "git clone failed".to_string() } else { reason };
            Err(skill_install_error(
                "SKILL_INSTALL_GIT_CLONE_FAILED",
                &format!("git clone failed: {reason}"),
                400,
            ))
        }
        Err(err) => Err(skill_install_error(
            "SKILL_INSTALL_GIT_CLONE_FAILED",
            &format!("git clone failed: {err}"),
            400,
        )),
    }
}

fn scan_skill_candidates(source_root: &Path, scope: &str, max_nodes: usize) -> Vec<SkillInstallCandidateInternal> {
    let mut stack = vec![source_root.to_path_buf()];
    let mut hits = Vec::new();
    let mut scanned = 0usize;

    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            scanned += 1;
            if scanned > max_nodes {
                return hits;
            }
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let full_path = entry.path();
            if file_type.is_dir() {
                if !is_ignored_dir(&entry.file_name().to_string_lossy()) {
                    stack.push(full_path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if entry.file_name().to_string_lossy() != "SKILL.md" {
                continue;
            }

            let parsed = parse_skill_file(&full_path);
            let mut warnings = Vec::new();
            let mut name = full_path
                .parent()
                .and_then(|p| p.file_name())
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let mut description = "(no description)".to_string();
            let mut valid = true;

            if let Some(parsed) = parsed {
                let fm = parsed.frontmatter;
                if let Some(value) = fm.get("name") {
                    if !value.trim().is_empty() {
                        name = value.trim().to_string();
                    }
                }
                if name.trim().is_empty() {
                    valid = false;
                    warnings.push("missing_name".to_string());
                    name = "unknown-skill".to_string();
                }
                if let Some(value) = fm.get("description") {
                    if !value.trim().is_empty() {
                        description = value.trim().to_string();
                    }
                }
                if description == "(no description)" {
                    let fallback = first_paragraph(&parsed.body);
                    if !fallback.is_empty() {
                        description = fallback.chars().take(120).collect();
                    } else {
                        warnings.push("missing_description".to_string());
                    }
                }
            } else {
                valid = false;
                warnings.push("parse_failed".to_string());
            }

            let relative = to_unix_relative_path(source_root, &full_path);
            hits.push(SkillInstallCandidateInternal {
                data: SkillInstallCandidate {
                    id: format!("candidate_{}", hits.len() + 1),
                    name,
                    description,
                    path: relative,
                    scope: scope.to_string(),
                    valid,
                    warnings,
                },
                source_dir: full_path.parent().unwrap_or(&full_path).to_path_buf(),
            });
        }
    }

    hits.sort_by(|a, b| a.data.name.to_lowercase().cmp(&b.data.name.to_lowercase()));
    hits
}

fn install_candidate_atomically(
    candidate: &SkillInstallCandidateInternal,
    target_root: &Path,
    conflict_policy: &str,
) -> Result<InstallOutcome, String> {
    let base_name = sanitize_skill_dir_name(&candidate.data.name);
    let default_target = target_root.join(&base_name);
    let mut final_target = default_target.clone();

    if final_target.exists() && conflict_policy == "rename" {
        final_target = find_rename_target(target_root, &base_name)?;
    }

    if final_target.exists() && conflict_policy == "skip" {
        return Ok(InstallOutcome::Skipped {
            target_path: final_target.to_string_lossy().to_string(),
            warning: "target_exists".to_string(),
        });
    }

    let stage_dir = target_root.join(format!(".{}.stage-{}", base_name, random_suffix()));
    let _ = fs::remove_dir_all(&stage_dir);
    copy_dir_recursive(&candidate.source_dir, &stage_dir)?;

    let mut backup_dir: Option<PathBuf> = None;
    if final_target.exists() && conflict_policy == "overwrite" {
        let backup = target_root.join(format!(".{}.bak-{}", base_name, random_suffix()));
        fs::rename(&final_target, &backup).map_err(|err| format!("backup failed: {err}"))?;
        backup_dir = Some(backup);
    } else if final_target.exists() && conflict_policy == "skip" {
        let _ = fs::remove_dir_all(&stage_dir);
        return Ok(InstallOutcome::Skipped {
            target_path: final_target.to_string_lossy().to_string(),
            warning: "target_exists".to_string(),
        });
    }

    let result = fs::rename(&stage_dir, &final_target);
    if let Err(err) = result {
        let _ = fs::remove_dir_all(&stage_dir);
        if let Some(backup) = backup_dir {
            if !final_target.exists() {
                let _ = fs::rename(&backup, &final_target);
            }
        }
        return Err(format!("install failed: {err}"));
    }

    if let Some(backup) = backup_dir {
        let _ = fs::remove_dir_all(backup);
    }

    Ok(InstallOutcome::Installed {
        target_path: final_target.to_string_lossy().to_string(),
    })
}

fn find_rename_target(target_root: &Path, base_name: &str) -> Result<PathBuf, String> {
    for idx in 1..=999 {
        let candidate = target_root.join(format!("{base_name}-{idx}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("rename target exhausted for {base_name}"))
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|err| format!("mkdir failed: {err}"))?;
    let entries = fs::read_dir(from).map_err(|err| format!("read dir failed: {err}"))?;
    for entry in entries.flatten() {
        let file_type = entry.file_type().map_err(|err| format!("stat failed: {err}"))?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else if file_type.is_file() {
            fs::copy(&src, &dest).map_err(|err| format!("copy failed: {err}"))?;
        }
    }
    Ok(())
}

fn sanitize_skill_dir_name(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        let invalid = ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let replace = invalid || ch.is_whitespace();
        if replace {
            if !last_dash {
                out.push('-');
                last_dash = true;
            }
            continue;
        }
        out.push(ch);
        last_dash = false;
    }
    let cleaned = out.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "skill".to_string()
    } else {
        cleaned
    }
}

fn is_remote_source(source: &str) -> bool {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with("git@") {
        return true;
    }
    if trimmed.contains("://") {
        return true;
    }
    let mut parts = trimmed.split('/');
    let first = parts.next().unwrap_or("");
    let second = parts.next().unwrap_or("");
    parts.next().is_none() && !first.is_empty() && !second.is_empty()
}

fn normalize_git_source(source: &str) -> String {
    let trimmed = source.trim();
    let mut parts = trimmed.split('/');
    let first = parts.next().unwrap_or("");
    let second = parts.next().unwrap_or("");
    if parts.next().is_none() && !first.is_empty() && !second.is_empty() && !trimmed.contains("://") {
        return format!("https://github.com/{first}/{second}.git");
    }
    trimmed.to_string()
}

fn random_id(prefix: &str) -> String {
    format!("{prefix}_{}", random_suffix())
}

fn random_suffix() -> String {
    let mut rng = rand::thread_rng();
    let value: u64 = rng.gen();
    format!("{}_{:x}", now_ms(), value)
}

fn parse_skill_file(path: &Path) -> Option<SkillFile> {
    let raw = fs::read_to_string(path).ok()?;
    if !raw.starts_with("---") {
        return Some(SkillFile {
            frontmatter: HashMap::new(),
            body: raw,
        });
    }
    let rest = &raw[3..];
    let end = rest.find("\n---")?;
    let fm_text = rest[..end].trim();
    let body = rest[end + 4..].trim_start().to_string();
    Some(SkillFile {
        frontmatter: parse_simple_yaml(fm_text),
        body,
    })
}

fn parse_simple_yaml(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(idx) = trimmed.find(':') else {
            continue;
        };
        if idx == 0 {
            continue;
        }
        let key = trimmed[..idx].trim().to_lowercase();
        let mut value = trimmed[idx + 1..].trim().to_string();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        } else if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        }
        out.insert(key, value);
    }
    out
}

fn normalize_bool(value: Option<&String>, fallback: bool) -> bool {
    let Some(raw) = value else {
        return fallback;
    };
    let raw = raw.trim().to_lowercase();
    match raw.as_str() {
        "true" | "1" | "yes" | "on" => true,
        "false" | "0" | "no" | "off" => false,
        _ => fallback,
    }
}

fn find_skills_in_root(root: &Path, scope: &str, source: &str) -> Vec<SkillMeta> {
    let entries = match fs::read_dir(root) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }
        let dir_path = entry.path();
        let skill_file = dir_path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        let parsed = match parse_skill_file(&skill_file) {
            Some(value) => value,
            None => continue,
        };
        let fm = parsed.frontmatter;
        let first_paragraph = first_paragraph(&parsed.body);
        let name = fm
            .get("name")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                dir_path
                    .file_name()
                    .map(|v| v.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            });
        let description = fm
            .get("description")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                if first_paragraph.is_empty() {
                    "(no description)".to_string()
                } else {
                    first_paragraph
                }
            });
        let allowed_tools = fm
            .get("allowed-tools")
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_else(Vec::new);
        let context = fm
            .get("context")
            .map(|v| v.trim().to_lowercase())
            .filter(|v| v == "fork")
            .unwrap_or_else(|| "inline".to_string());
        let disable_model_invocation = normalize_bool(fm.get("disable-model-invocation"), false);
        let user_invocable = normalize_bool(fm.get("user-invocable"), true);
        let agent = fm.get("agent").map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let model = fm.get("model").map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let argument_hint = fm
            .get("argument-hint")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        skills.push(SkillMeta {
            id: format!("{scope}:{source}:{name}"),
            name,
            description,
            path: skill_file.to_string_lossy().to_string(),
            scope: scope.to_string(),
            source: source.to_string(),
            disable_model_invocation,
            user_invocable,
            context,
            allowed_tools,
            agent,
            model,
            argument_hint,
        });
    }
    skills
}

fn dedup_by_priority(skills: Vec<SkillMeta>) -> Vec<SkillMeta> {
    let mut ordered = skills;
    ordered.sort_by(|a, b| {
        let rank = |item: &SkillMeta| -> u8 {
            match (item.scope.as_str(), item.source.as_str()) {
                ("project", ".agents") => 0,
                ("project", ".claude") => 1,
                ("user", ".agents") => 2,
                _ => 3,
            }
        };
        let ra = rank(a);
        let rb = rank(b);
        if ra != rb {
            return ra.cmp(&rb);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    let mut pick: HashMap<String, SkillMeta> = HashMap::new();
    for item in ordered {
        let key = item.name.to_lowercase();
        pick.entry(key).or_insert(item);
    }
    let mut values: Vec<SkillMeta> = pick.into_values().collect();
    values.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    values
}

fn render_skill_args_template(input: &str, args_raw: &str) -> String {
    let args: Vec<String> = args_raw
        .split_whitespace()
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .collect();

    let mut text = input.replace("$ARGUMENTS", args_raw);
    text = replace_argument_indices(&text, "$ARGUMENTS[", "]", &args);
    text = replace_dollar_indices(&text, &args);

    if !args_raw.is_empty() && !contains_args_token(input) {
        text.push_str("\n\nARGUMENTS: ");
        text.push_str(args_raw);
    }
    text
}

fn contains_args_token(input: &str) -> bool {
    if input.contains("$ARGUMENTS") {
        return true;
    }
    let bytes = input.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        if bytes[idx] == b'$' {
            let j = idx + 1;
            if j < bytes.len() && bytes[j].is_ascii_digit() {
                return true;
            }
            idx = j;
        } else {
            idx += 1;
        }
    }
    false
}

fn replace_argument_indices(input: &str, prefix: &str, suffix: &str, args: &[String]) -> String {
    let mut out = String::new();
    let mut idx = 0;
    while let Some(start) = input[idx..].find(prefix) {
        let abs_start = idx + start;
        out.push_str(&input[idx..abs_start]);
        let after_prefix = abs_start + prefix.len();
        if let Some(end) = input[after_prefix..].find(suffix) {
            let abs_end = after_prefix + end;
            let num_text = &input[after_prefix..abs_end];
            let replacement = num_text
                .parse::<usize>()
                .ok()
                .and_then(|value| args.get(value))
                .cloned()
                .unwrap_or_default();
            out.push_str(&replacement);
            idx = abs_end + suffix.len();
        } else {
            out.push_str(prefix);
            idx = after_prefix;
        }
    }
    out.push_str(&input[idx..]);
    out
}

fn replace_dollar_indices(input: &str, args: &[String]) -> String {
    let mut out = String::new();
    let chars: Vec<char> = input.chars().collect();
    let mut idx = 0;
    while idx < chars.len() {
        if chars[idx] == '$' {
            let mut j = idx + 1;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            if j > idx + 1 {
                let number: usize = chars[idx + 1..j]
                    .iter()
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0);
                if number > 0 {
                    let replacement = args.get(number - 1).cloned().unwrap_or_default();
                    out.push_str(&replacement);
                    idx = j;
                    continue;
                }
            }
        }
        out.push(chars[idx]);
        idx += 1;
    }
    out
}

fn first_paragraph(text: &str) -> String {
    for part in text.split("\n\n") {
        let trimmed = part.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    String::new()
}

fn to_unix_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        ".git" | "node_modules" | "dist" | "build" | ".next" | ".cache"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon_state::{read_state, DaemonState, write_state};
    use std::fs;

    fn temp_root(label: &str) -> std::path::PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|v| v.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("yuanio-{label}-{now}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn discover_skills_prefers_project_agents() {
        let root = temp_root("skills-project");
        let home = temp_root("skills-home");
        let agents = root.join(".agents/skills/alpha");
        let claude = root.join(".claude/skills/alpha");
        fs::create_dir_all(&agents).unwrap();
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            agents.join("SKILL.md"),
            "---\nname: Alpha\n---\nAlpha skill from agents.\n",
        )
        .unwrap();
        fs::write(
            claude.join("SKILL.md"),
            "---\nname: Alpha\n---\nAlpha skill from claude.\n",
        )
        .unwrap();

        let skills = SkillEngine::discover_skills(&root, &home);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Alpha");
        assert_eq!(skills[0].scope, "project");
        assert_eq!(skills[0].source, ".agents");
    }

    #[test]
    fn prepare_scans_candidates() {
        let root = temp_root("skills-source");
        let home = temp_root("skills-home");
        let source_root = root.join("source/alpha");
        fs::create_dir_all(&source_root).unwrap();
        fs::write(
            source_root.join("SKILL.md"),
            "---\nname: Alpha\n---\nAlpha skill.\n",
        )
        .unwrap();

        let mut engine = SkillInstallEngine::new();
        let resp = engine.prepare("source", Some("project"), &root, &home).unwrap();
        assert_eq!(resp.candidates.len(), 1);
        assert_eq!(resp.candidates[0].name, "Alpha");
        assert!(resp.candidates[0].valid);
    }

    #[test]
    fn daemon_state_roundtrip() {
        let state_path = temp_root("daemon-state").join("daemon.json");
        std::env::set_var("YUANIO_DAEMON_STATE", state_path.to_string_lossy().to_string());
        let input = DaemonState {
            pid: 123,
            port: 456,
            version: "test".to_string(),
            started_at: "now".to_string(),
            sessions: vec!["s1".to_string()],
        };
        write_state(&input).unwrap();
        let loaded = read_state().unwrap();
        assert_eq!(loaded.pid, 123);
        assert_eq!(loaded.port, 456);
        assert_eq!(loaded.version, "test");
        assert_eq!(loaded.sessions, vec!["s1".to_string()]);
    }
}

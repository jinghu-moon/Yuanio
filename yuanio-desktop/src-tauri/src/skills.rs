use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Mutex, OnceLock};

use crate::daemon::{DaemonServer, DaemonServerHandle};
use crate::daemon_state::read_state;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
    pub source: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCandidate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub valid: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLogItem {
    pub id: String,
    pub at: u64,
    pub level: String,
    pub action: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallPrepareResponse {
    pub install_id: String,
    pub candidates: Vec<SkillCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallStatusResponse {
    pub candidates: Vec<SkillCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCommitResponse {
    pub total: u32,
    pub installed: Vec<Value>,
    pub skipped: Vec<Value>,
    pub failed: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallCancelResponse {
    pub cancelled: bool,
    pub existed: bool,
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn daemon_handle() -> &'static Mutex<Option<DaemonServerHandle>> {
    static HANDLE: OnceLock<Mutex<Option<DaemonServerHandle>>> = OnceLock::new();
    HANDLE.get_or_init(|| Mutex::new(None))
}

fn ensure_daemon_running() -> Result<(), String> {
    if let Some(state) = read_state() {
        if state.port != 0 {
            return Ok(());
        }
    }
    let handle = DaemonServer::spawn().map_err(|e| format!("启动 daemon 失败: {e}"))?;
    let mut guard = daemon_handle().lock().map_err(|_| "daemon 句柄被占用".to_string())?;
    *guard = Some(handle);
    Ok(())
}

fn daemon_base_url() -> Result<String, String> {
    ensure_daemon_running()?;
    let state = read_state().ok_or_else(|| "Daemon 未运行".to_string())?;
    if state.port == 0 {
        return Err("Daemon 端口未知".to_string());
    }
    Ok(format!("http://localhost:{}", state.port))
}

fn parse_response<T: for<'de> Deserialize<'de>>(res: reqwest::blocking::Response) -> Result<T, String> {
    let status = res.status();
    let text = res.text().unwrap_or_default();
    let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()));
    if !status.is_success() {
        if let Some(error) = json.get("error").and_then(|v| v.as_str()) {
            return Err(error.to_string());
        }
        return Err(format!("HTTP {}", status));
    }
    serde_json::from_value(json).map_err(|e| format!("解析响应失败: {e}"))
}

#[tauri::command]
pub fn skills_list(scope: Option<String>) -> Result<Vec<SkillItem>, String> {
    let base = daemon_base_url()?;
    let mut url = Url::parse(&format!("{base}/skills/list"))
        .map_err(|e| format!("URL 解析失败: {e}"))?;
    let scope_value = scope.unwrap_or_else(|| "all".to_string());
    url.query_pairs_mut().append_pair("scope", &scope_value);

    let client = http_client()?;
    let res = client.get(url).send().map_err(|e| format!("请求失败: {e}"))?;
    let payload: Value = parse_response(res)?;
    let items = payload.get("items").cloned().unwrap_or(Value::Array(vec![]));
    serde_json::from_value(items).map_err(|e| format!("解析列表失败: {e}"))
}

#[tauri::command]
pub fn skills_logs(limit: Option<u16>) -> Result<Vec<SkillLogItem>, String> {
    let base = daemon_base_url()?;
    let mut url = Url::parse(&format!("{base}/skills/logs"))
        .map_err(|e| format!("URL 解析失败: {e}"))?;
    let limit_value = limit.unwrap_or(20).to_string();
    url.query_pairs_mut().append_pair("limit", &limit_value);

    let client = http_client()?;
    let res = client.get(url).send().map_err(|e| format!("请求失败: {e}"))?;
    let payload: Value = parse_response(res)?;
    let items = payload.get("items").cloned().unwrap_or(Value::Array(vec![]));
    serde_json::from_value(items).map_err(|e| format!("解析日志失败: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallPreparePayload {
    source: String,
    scope: String,
}

#[tauri::command]
pub fn skills_install_prepare(source: String, scope: String) -> Result<SkillInstallPrepareResponse, String> {
    let base = daemon_base_url()?;
    let url = format!("{base}/skills/install/prepare");
    let client = http_client()?;
    let res = client
        .post(url)
        .json(&SkillInstallPreparePayload { source, scope })
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    parse_response(res)
}

#[tauri::command]
pub fn skills_install_status(install_id: String) -> Result<SkillInstallStatusResponse, String> {
    let base = daemon_base_url()?;
    let url = format!("{base}/skills/install/status/{}", install_id.trim());
    let client = http_client()?;
    let res = client.get(url).send().map_err(|e| format!("请求失败: {e}"))?;
    parse_response(res)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallCommitPayload {
    install_id: String,
    selected: Vec<String>,
    conflict_policy: String,
}

#[tauri::command]
pub fn skills_install_commit(
    install_id: String,
    selected: Vec<String>,
    conflict_policy: String,
) -> Result<SkillInstallCommitResponse, String> {
    let base = daemon_base_url()?;
    let url = format!("{base}/skills/install/commit");
    let client = http_client()?;
    let res = client
        .post(url)
        .json(&SkillInstallCommitPayload {
            install_id,
            selected,
            conflict_policy,
        })
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    parse_response(res)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallCancelPayload {
    install_id: String,
}

#[tauri::command]
pub fn skills_install_cancel(install_id: String) -> Result<SkillInstallCancelResponse, String> {
    let base = daemon_base_url()?;
    let url = format!("{base}/skills/install/cancel");
    let client = http_client()?;
    let res = client
        .post(url)
        .json(&SkillInstallCancelPayload { install_id })
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    parse_response(res)
}

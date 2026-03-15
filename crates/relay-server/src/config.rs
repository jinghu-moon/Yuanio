use std::{
    env,
    fs,
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
};

const MIN_JWT_SECRET_LENGTH: usize = 32;

#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub require_protocol_version: bool,
    pub db_path: PathBuf,
    pub db_busy_timeout_ms: u64,
    pub db_fast_write_mode: bool,
    pub fcm_token_max_length: usize,
    pub fcm_enabled: bool,
    pub push_register_rate_limit_max: u64,
    pub push_register_rate_limit_window_ms: u64,
}

pub fn load_env_files() {
    for file in resolve_env_files() {
        if file.exists() {
            let _ = dotenvy::from_path(&file);
        }
    }
}

pub fn load_config() -> Result<RelayConfig, String> {
    let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);
    let jwt_secret = env::var("JWT_SECRET").map_err(|_| "JWT_SECRET is required".to_string())?;
    if jwt_secret.trim().len() < MIN_JWT_SECRET_LENGTH {
        return Err(format!(
            "JWT_SECRET must be at least {} characters",
            MIN_JWT_SECRET_LENGTH
        ));
    }

    let db_path = env::var("YUANIO_DB_PATH").unwrap_or_else(|_| "yuanio.db".to_string());
    let db_busy_timeout_ms = env::var("YUANIO_DB_BUSY_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(3000);
    let db_fast_write_mode = env::var("YUANIO_DB_FAST_WRITE_MODE")
        .map(|value| value != "0")
        .unwrap_or(true);
    let require_protocol_version = env::var("YUANIO_REQUIRE_PROTOCOL_VERSION")
        .map(|value| value == "1")
        .unwrap_or(false);
    let fcm_token_max_length = env::var("YUANIO_FCM_TOKEN_MAX_LENGTH")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(4096)
        .max(128);
    let fcm_enabled = env::var("FCM_SERVICE_ACCOUNT")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let push_register_rate_limit_max = env::var("YUANIO_PUSH_REGISTER_RATE_LIMIT_MAX")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20)
        .max(1);
    let push_register_rate_limit_window_ms = env::var("YUANIO_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(60_000)
        .max(1_000);

    Ok(RelayConfig {
        host,
        port,
        jwt_secret: jwt_secret.trim().to_string(),
        require_protocol_version,
        db_path: PathBuf::from(db_path),
        db_busy_timeout_ms,
        db_fast_write_mode,
        fcm_token_max_length,
        fcm_enabled,
        push_register_rate_limit_max,
        push_register_rate_limit_window_ms,
    })
}

pub fn parse_host(host: &str) -> IpAddr {
    host.parse().unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

fn resolve_env_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    let workspace_root = find_workspace_root(env::current_dir().ok().as_deref());
    if let Some(root) = workspace_root {
        files.push(root.join(".env"));
        files.push(root.join(".env.local"));
    }
    if let Some(home) = home_dir() {
        files.push(home.join(".yuanio").join("runtime.env"));
    }
    dedup_existing(files)
}

fn find_workspace_root(start: Option<&Path>) -> Option<PathBuf> {
    let mut current = start?.to_path_buf();
    loop {
        let candidate = current.join("package.json");
        if candidate.exists() && has_workspaces(&candidate) {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn has_workspaces(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    value.get("workspaces").is_some()
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn dedup_existing(files: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for file in files {
        let key = file.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            result.push(file);
        }
    }
    result
}

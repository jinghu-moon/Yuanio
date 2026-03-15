use std::{
    collections::HashMap,
    env,
    fs,
    path::{Path, PathBuf},
};

use crate::resolve_repo_root;
use super::protocol::MAX_ENVELOPE_BINARY_PAYLOAD_BYTES;

const MIN_JWT_SECRET_LENGTH: usize = 32;

#[derive(Debug, Clone)]
pub struct RelayRuntimeEnv {
    pub env: HashMap<String, String>,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub port: u16,
    pub db_path: String,
    pub db_busy_timeout_ms: u64,
    pub db_fast_write_mode: bool,
    pub jwt_secret: String,
    pub require_protocol_version: bool,
    pub max_payload_bytes: usize,
}

impl RelayConfig {
    pub fn from_env() -> Result<Self, String> {
        let runtime = load_relay_runtime_env();
        let jwt_secret = require_jwt_secret(&runtime)?;
        let port = read_u16(&runtime.env, "PORT").unwrap_or(3000);
        let db_path = runtime
            .env
            .get("YUANIO_DB_PATH")
            .cloned()
            .unwrap_or_else(|| "yuanio.db".to_string());
        let db_busy_timeout_ms = read_u64(&runtime.env, "YUANIO_DB_BUSY_TIMEOUT_MS").unwrap_or(3000);
        let db_fast_write_mode = runtime
            .env
            .get("YUANIO_DB_FAST_WRITE_MODE")
            .map(|value| value.trim() != "0")
            .unwrap_or(true);
        let require_protocol_version = read_bool_flag(&runtime.env, "YUANIO_REQUIRE_PROTOCOL_VERSION");
        let max_payload_bytes = read_usize(&runtime.env, "YUANIO_RELAY_MAX_HTTP_BUFFER_BYTES")
            .map(|value| value.max(16 * 1024))
            .unwrap_or(MAX_ENVELOPE_BINARY_PAYLOAD_BYTES);
        Ok(Self {
            port,
            db_path,
            db_busy_timeout_ms,
            db_fast_write_mode,
            jwt_secret,
            require_protocol_version,
            max_payload_bytes,
        })
    }
}

pub fn load_relay_runtime_env() -> RelayRuntimeEnv {
    let mut sources = Vec::new();
    let mut env_map = HashMap::new();

    for path in get_relay_runtime_env_files() {
        if let Ok(content) = fs::read_to_string(&path) {
            env_map.extend(parse_env_file(&content));
            sources.push(path.to_string_lossy().to_string());
        }
    }

    for (key, value) in env::vars() {
        env_map.insert(key, value);
    }

    RelayRuntimeEnv {
        env: env_map,
        sources,
    }
}

fn get_relay_runtime_env_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    let root = resolve_repo_root();
    files.push(root.join(".env"));
    files.push(root.join(".env.local"));

    if let Some(home) = resolve_home_dir() {
        files.push(home.join(".yuanio").join("runtime.env"));
    }

    let mut seen = HashMap::<String, bool>::new();
    let mut result = Vec::new();
    for path in files {
        if !path.is_file() {
            continue;
        }
        let normalized = normalize_path_key(&path);
        if seen.contains_key(&normalized) {
            continue;
        }
        seen.insert(normalized, true);
        result.push(path);
    }
    result
}

fn parse_env_file(content: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for raw_line in content.lines() {
        let mut line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(stripped) = line.strip_prefix("export ") {
            line = stripped.trim();
        }
        let Some(split) = line.find('=') else { continue };
        let key = line[..split].trim();
        let mut value = line[split + 1..].trim().to_string();
        if key.is_empty() {
            continue;
        }
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len() - 1].to_string();
        }
        result.insert(key.to_string(), value);
    }
    result
}

fn require_jwt_secret(runtime: &RelayRuntimeEnv) -> Result<String, String> {
    let Some(secret) = runtime.env.get("JWT_SECRET").map(|v| v.trim()).filter(|v| !v.is_empty()) else {
        let errors = vec!["JWT_SECRET is required".to_string()];
        return Err(build_runtime_env_error(&errors, &runtime.sources));
    };
    if secret.len() < MIN_JWT_SECRET_LENGTH {
        let errors = vec![format!("JWT_SECRET must be at least {MIN_JWT_SECRET_LENGTH} characters")];
        return Err(build_runtime_env_error(&errors, &runtime.sources));
    }
    Ok(secret.to_string())
}

fn build_runtime_env_error(errors: &[String], sources: &[String]) -> String {
    let source_text = if sources.is_empty() {
        "no .env / .env.local / ~/.yuanio/runtime.env found".to_string()
    } else {
        format!("searched: {}", sources.join(", "))
    };
    format!("Relay runtime env invalid: {} ({source_text})", errors.join("; "))
}

fn resolve_home_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        env::var("USERPROFILE").ok().map(PathBuf::from)
    } else {
        env::var("HOME").ok().map(PathBuf::from)
    }
}

fn read_u16(env_map: &HashMap<String, String>, key: &str) -> Option<u16> {
    env_map.get(key)?.trim().parse::<u16>().ok()
}

fn read_usize(env_map: &HashMap<String, String>, key: &str) -> Option<usize> {
    env_map.get(key)?.trim().parse::<usize>().ok()
}

fn read_u64(env_map: &HashMap<String, String>, key: &str) -> Option<u64> {
    env_map.get(key)?.trim().parse::<u64>().ok()
}

fn read_bool_flag(env_map: &HashMap<String, String>, key: &str) -> bool {
    env_map.get(key).map(|v| v.trim() == "1").unwrap_or(false)
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

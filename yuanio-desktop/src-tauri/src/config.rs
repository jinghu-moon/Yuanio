use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub server_url: String,
    pub namespace: String,
    pub relay_port: u16,
    pub auto_start: bool,
    pub connection_profile: String,
    pub tunnel_mode: String,
    pub tunnel_name: String,
    pub tunnel_hostname: String,
    pub language: String,
}

fn resolve_base_dir() -> PathBuf {
    if let Ok(path) = std::env::var("YUANIO_CONFIG_DIR") {
        return PathBuf::from(path);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".yuanio")
}

fn resolve_config_path() -> PathBuf {
    resolve_base_dir().join("config.json")
}

fn detect_language_from_env() -> String {
    let raw = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_MESSAGES"))
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_default()
        .to_lowercase();
    if raw.contains("zh_tw") || raw.contains("zh-hk") || raw.contains("zh_hk") {
        return "zh-TW".to_string();
    }
    if raw.contains("zh") {
        return "zh-CN".to_string();
    }
    "en".to_string()
}

fn default_config() -> AppConfig {
    AppConfig {
        server_url: "https://seeyuer-yuanio.us.ci".to_string(),
        namespace: "default".to_string(),
        relay_port: 3000,
        auto_start: false,
        connection_profile: "tunnel".to_string(),
        tunnel_mode: "named".to_string(),
        tunnel_name: "yuanio".to_string(),
        tunnel_hostname: "seeyuer-yuanio.us.ci".to_string(),
        language: detect_language_from_env(),
    }
}

fn normalize_config(input: AppConfig) -> AppConfig {
    let mut cfg = input;
    if cfg.server_url.trim().is_empty() {
        cfg.server_url = default_config().server_url;
    }
    if cfg.namespace.trim().is_empty() {
        cfg.namespace = "default".to_string();
    }
    if cfg.relay_port == 0 {
        cfg.relay_port = 3000;
    }
    if cfg.connection_profile != "lan" {
        cfg.connection_profile = "tunnel".to_string();
    }
    if cfg.tunnel_mode != "quick" {
        cfg.tunnel_mode = "named".to_string();
    }
    if cfg.language != "zh-CN" && cfg.language != "zh-TW" && cfg.language != "en" {
        cfg.language = "zh-CN".to_string();
    }
    cfg
}

fn merge_config(base: AppConfig, override_cfg: AppConfig) -> AppConfig {
    AppConfig {
        server_url: if override_cfg.server_url.trim().is_empty() {
            base.server_url
        } else {
            override_cfg.server_url
        },
        namespace: if override_cfg.namespace.trim().is_empty() {
            base.namespace
        } else {
            override_cfg.namespace
        },
        relay_port: if override_cfg.relay_port == 0 {
            base.relay_port
        } else {
            override_cfg.relay_port
        },
        auto_start: override_cfg.auto_start,
        connection_profile: if override_cfg.connection_profile.trim().is_empty() {
            base.connection_profile
        } else {
            override_cfg.connection_profile
        },
        tunnel_mode: if override_cfg.tunnel_mode.trim().is_empty() {
            base.tunnel_mode
        } else {
            override_cfg.tunnel_mode
        },
        tunnel_name: if override_cfg.tunnel_name.trim().is_empty() {
            base.tunnel_name
        } else {
            override_cfg.tunnel_name
        },
        tunnel_hostname: if override_cfg.tunnel_hostname.trim().is_empty() {
            base.tunnel_hostname
        } else {
            override_cfg.tunnel_hostname
        },
        language: if override_cfg.language.trim().is_empty() {
            base.language
        } else {
            override_cfg.language
        },
    }
}

fn read_config() -> AppConfig {
    let path = resolve_config_path();
    if !path.exists() {
        return default_config();
    }
    let content = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return default_config(),
    };
    match serde_json::from_str::<AppConfig>(&content) {
        Ok(parsed) => normalize_config(parsed),
        Err(_) => default_config(),
    }
}

fn write_config(config: &AppConfig) -> Result<(), String> {
    let dir = resolve_base_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let path = resolve_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化 config 失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("写入 config 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn config_load() -> Result<AppConfig, String> {
    Ok(read_config())
}

#[tauri::command]
pub fn config_save(config: AppConfig) -> Result<AppConfig, String> {
    let base = default_config();
    let merged = merge_config(base, config);
    let normalized = normalize_config(merged);
    write_config(&normalized)?;
    Ok(normalized)
}

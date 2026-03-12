use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::pairing::StoredKeys;

const KEYSTORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredSession {
    pub schema_version: u32,
    pub keys: StoredKeys,
}

fn resolve_base_dir() -> PathBuf {
    if let Ok(path) = std::env::var("YUANIO_KEYSTORE_DIR") {
        return PathBuf::from(path);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".yuanio")
}

fn resolve_keys_path() -> PathBuf {
    resolve_base_dir().join("keys.json")
}

pub fn save_keys(session: &StoredSession) -> Result<(), String> {
    let dir = resolve_base_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let path = resolve_keys_path();
    let content = serde_json::to_string_pretty(session)
        .map_err(|e| format!("序列化 keys 失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("写入 keys 失败: {e}"))?;
    Ok(())
}

pub fn load_keys() -> Result<Option<StoredSession>, String> {
    let path = resolve_keys_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取 keys 失败: {e}"))?;
    let parsed = serde_json::from_str::<StoredSession>(&content)
        .map_err(|e| format!("解析 keys 失败: {e}"))?;
    Ok(Some(parsed))
}

pub fn new_session(keys: StoredKeys) -> StoredSession {
    StoredSession {
        schema_version: KEYSTORE_SCHEMA_VERSION,
        keys,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yuanio-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = with_temp_dir();
        std::env::set_var("YUANIO_KEYSTORE_DIR", &dir);

        let session = StoredSession {
            schema_version: 1,
            keys: StoredKeys {
                crypto_version: "rust-ecdh".to_string(),
                protocol_version: "1.0.0".to_string(),
                namespace: "default".to_string(),
                public_key: "pub".to_string(),
                private_key: "priv".to_string(),
                device_id: "device-1".to_string(),
                session_id: "session-1".to_string(),
                session_token: "token".to_string(),
                peer_public_key: "peer".to_string(),
                server_url: "http://localhost:3000".to_string(),
            },
        };

        save_keys(&session).expect("save keys");
        let loaded = load_keys().expect("load keys").expect("some keys");
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.keys.session_id, "session-1");

        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("YUANIO_KEYSTORE_DIR");
    }
}

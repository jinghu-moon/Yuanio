use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::crypto::generate_keypair;
use crate::keystore::{new_session, StoredSession};

const PROTOCOL_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredKeys {
    pub crypto_version: String,
    pub protocol_version: String,
    pub namespace: String,
    pub public_key: String,
    pub private_key: String,
    pub device_id: String,
    pub session_id: String,
    pub session_token: String,
    pub peer_public_key: String,
    pub server_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairCreateResponse {
    #[serde(rename = "pairingCode")]
    pub pairing_code: String,
    #[serde(rename = "sessionToken")]
    pub session_token: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub namespace: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairStatusResponse {
    pub joined: bool,
    #[serde(rename = "appPublicKey")]
    pub app_public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairJoinResponse {
    #[serde(rename = "agentPublicKey")]
    pub agent_public_key: String,
    #[serde(rename = "sessionToken")]
    pub session_token: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub namespace: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
}

#[derive(Debug, Clone)]
pub struct DerivedKeys {
    pub session: StoredSession,
    pub pairing_code: String,
}

#[derive(Debug, Clone)]
pub struct PendingPairing {
    pub server_url: String,
    pub keypair: crate::crypto::KeyPair,
    pub create: PairCreateResponse,
}

pub trait PairingClient {
    fn create_pair(&self, server_url: &str, namespace: &str, public_key: &str) -> Result<PairCreateResponse, String>;
    fn join_pair(&self, server_url: &str, code: &str, public_key: &str) -> Result<PairJoinResponse, String>;
    fn poll_status(&self, server_url: &str, code: &str) -> Result<PairStatusResponse, String>;
}

pub struct ReqwestPairingClient {
    client: reqwest::blocking::Client,
}

impl ReqwestPairingClient {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
        Ok(Self { client })
    }
}

impl PairingClient for ReqwestPairingClient {
    fn create_pair(&self, server_url: &str, namespace: &str, public_key: &str) -> Result<PairCreateResponse, String> {
        let url = format!("{}/api/v1/pair/create", server_url.trim_end_matches('/'));
        let mut body = HashMap::new();
        body.insert("publicKey", public_key);
        body.insert("namespace", namespace);
        body.insert("protocolVersion", PROTOCOL_VERSION);

        let res = self.client
            .post(url)
            .header("Content-Type", "application/json")
            .header("x-yuanio-namespace", namespace)
            .header("x-yuanio-protocol-version", PROTOCOL_VERSION)
            .json(&body)
            .send()
            .map_err(|e| format!("pair/create 失败: {e}"))?;

        if res.status().as_u16() == 429 {
            return Err("配对请求过于频繁，请稍后再试".to_string());
        }
        if !res.status().is_success() {
            return Err(format!("配对请求失败: HTTP {}", res.status()));
        }

        res.json::<PairCreateResponse>().map_err(|e| format!("解析 pair/create 失败: {e}"))
    }

    fn join_pair(&self, server_url: &str, code: &str, public_key: &str) -> Result<PairJoinResponse, String> {
        let url = format!("{}/api/v1/pair/join", server_url.trim_end_matches('/'));
        let mut body = HashMap::new();
        body.insert("code", code);
        body.insert("publicKey", public_key);

        let res = self.client
            .post(url)
            .header("Content-Type", "application/json")
            .header("x-yuanio-protocol-version", PROTOCOL_VERSION)
            .json(&body)
            .send()
            .map_err(|e| format!("pair/join 失败: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("pair/join 失败: HTTP {}", res.status()));
        }

        res.json::<PairJoinResponse>().map_err(|e| format!("解析 pair/join 失败: {e}"))
    }

    fn poll_status(&self, server_url: &str, code: &str) -> Result<PairStatusResponse, String> {
        let url = format!("{}/api/v1/pair/status/{}", server_url.trim_end_matches('/'), code);
        let res = self.client
            .get(url)
            .send()
            .map_err(|e| format!("pair/status 失败: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("pair/status 失败: HTTP {}", res.status()));
        }

        res.json::<PairStatusResponse>().map_err(|e| format!("解析 pair/status 失败: {e}"))
    }
}

pub fn start_pairing(
    client: &dyn PairingClient,
    server_url: &str,
    namespace: &str,
) -> Result<DerivedKeys, String> {
    let pending = create_pairing(client, server_url, namespace)?;

    let poll_deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    let app_public_key = loop {
        let status = client.poll_status(server_url, &pending.create.pairing_code)?;
        if status.joined {
            if let Some(pk) = status.app_public_key {
                break pk;
            }
        }
        if std::time::Instant::now() > poll_deadline {
            return Err("配对超时".to_string());
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    };

    finalize_pairing(pending, app_public_key)
}

pub fn join_pairing(
    client: &dyn PairingClient,
    server_url: &str,
    code: &str,
) -> Result<DerivedKeys, String> {
    let kp = generate_keypair()?;
    let join = client.join_pair(server_url, code, &kp.public_key)?;

    let stored = StoredKeys {
        crypto_version: "rust-ecdh".to_string(),
        protocol_version: join.protocol_version.clone(),
        namespace: join.namespace.clone(),
        public_key: kp.public_key.clone(),
        private_key: kp.private_key.clone(),
        device_id: join.device_id.clone(),
        session_id: join.session_id.clone(),
        session_token: join.session_token.clone(),
        peer_public_key: join.agent_public_key.clone(),
        server_url: server_url.to_string(),
    };

    Ok(DerivedKeys {
        session: new_session(stored),
        pairing_code: code.to_string(),
    })
}

pub fn create_pairing(
    client: &dyn PairingClient,
    server_url: &str,
    namespace: &str,
) -> Result<PendingPairing, String> {
    let kp = generate_keypair()?;
    let create = client.create_pair(server_url, namespace, &kp.public_key)?;
    Ok(PendingPairing {
        server_url: server_url.to_string(),
        keypair: kp,
        create,
    })
}

pub fn finalize_pairing(
    pending: PendingPairing,
    app_public_key: String,
) -> Result<DerivedKeys, String> {
    let stored = StoredKeys {
        crypto_version: "rust-ecdh".to_string(),
        protocol_version: pending.create.protocol_version.clone(),
        namespace: pending.create.namespace.clone(),
        public_key: pending.keypair.public_key.clone(),
        private_key: pending.keypair.private_key.clone(),
        device_id: pending.create.device_id.clone(),
        session_id: pending.create.session_id.clone(),
        session_token: pending.create.session_token.clone(),
        peer_public_key: app_public_key,
        server_url: pending.server_url.clone(),
    };

    Ok(DerivedKeys {
        session: new_session(stored),
        pairing_code: pending.create.pairing_code.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeClient {
        create: PairCreateResponse,
        status_ready: PairStatusResponse,
        join: PairJoinResponse,
    }

    impl PairingClient for FakeClient {
        fn create_pair(&self, _server_url: &str, _namespace: &str, _public_key: &str) -> Result<PairCreateResponse, String> {
            Ok(self.create.clone())
        }

        fn join_pair(&self, _server_url: &str, _code: &str, _public_key: &str) -> Result<PairJoinResponse, String> {
            Ok(self.join.clone())
        }

        fn poll_status(&self, _server_url: &str, _code: &str) -> Result<PairStatusResponse, String> {
            Ok(self.status_ready.clone())
        }
    }

    #[test]
    fn start_pairing_creates_stored_keys() {
        let client = FakeClient {
            create: PairCreateResponse {
                pairing_code: "123-456".to_string(),
                session_token: "token".to_string(),
                device_id: "device-1".to_string(),
                session_id: "session-1".to_string(),
                namespace: "default".to_string(),
                protocol_version: "1.0.0".to_string(),
            },
            status_ready: PairStatusResponse {
                joined: true,
                app_public_key: Some(generate_keypair().unwrap().public_key),
            },
            join: PairJoinResponse {
                agent_public_key: generate_keypair().unwrap().public_key,
                session_token: "token".to_string(),
                device_id: "device-2".to_string(),
                session_id: "session-1".to_string(),
                namespace: "default".to_string(),
                protocol_version: "1.0.0".to_string(),
            },
        };

        let result = start_pairing(&client, "http://localhost:3000", "default").unwrap();
        assert_eq!(result.session.keys.session_id, "session-1");
        assert_eq!(result.session.keys.namespace, "default");
        assert_eq!(result.pairing_code, "123-456");
    }

    #[test]
    fn join_pairing_creates_stored_keys() {
        let client = FakeClient {
            create: PairCreateResponse {
                pairing_code: "123-456".to_string(),
                session_token: "token".to_string(),
                device_id: "device-1".to_string(),
                session_id: "session-1".to_string(),
                namespace: "default".to_string(),
                protocol_version: "1.0.0".to_string(),
            },
            status_ready: PairStatusResponse {
                joined: true,
                app_public_key: Some(generate_keypair().unwrap().public_key),
            },
            join: PairJoinResponse {
                agent_public_key: generate_keypair().unwrap().public_key,
                session_token: "token".to_string(),
                device_id: "device-2".to_string(),
                session_id: "session-1".to_string(),
                namespace: "default".to_string(),
                protocol_version: "1.0.0".to_string(),
            },
        };

        let result = join_pairing(&client, "http://localhost:3000", "123-456").unwrap();
        assert_eq!(result.session.keys.session_id, "session-1");
        assert_eq!(result.session.keys.device_id, "device-2");
        assert_eq!(result.pairing_code, "123-456");
    }
}

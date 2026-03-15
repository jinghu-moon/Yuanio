use crate::config::RelayConfig;
use crate::db::RelayDb;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use relay_protocol::{normalize_namespace, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};

const ISSUER: &str = "yuanio-relay";
const EXPIRY_SECONDS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPayload {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub role: String,
    pub namespace: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    role: String,
    namespace: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
    exp: usize,
    iat: usize,
    iss: String,
    sub: String,
}

pub fn sign_token(config: &RelayConfig, payload: &TokenPayload) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();
    let protocol_version = if payload.protocol_version.trim().is_empty() {
        PROTOCOL_VERSION.to_string()
    } else {
        payload.protocol_version.clone()
    };
    let namespace = normalize_namespace(Some(&payload.namespace));
    let claims = Claims {
        device_id: payload.device_id.clone(),
        session_id: payload.session_id.clone(),
        role: payload.role.clone(),
        namespace: namespace.clone(),
        protocol_version,
        exp: (now + EXPIRY_SECONDS) as usize,
        iat: now as usize,
        iss: ISSUER.to_string(),
        sub: format!("{}:{}", namespace, payload.device_id),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|err| err.to_string())
}

pub fn verify_token(config: &RelayConfig, db: &RelayDb, token: &str) -> Result<TokenPayload, String> {
    if db.is_token_revoked(token)? {
        return Err("token revoked".to_string());
    }
    let mut validation = Validation::default();
    validation.set_issuer(&[ISSUER]);
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| "invalid or expired token".to_string())?;
    let claims = data.claims;
    Ok(TokenPayload {
        device_id: claims.device_id,
        session_id: claims.session_id,
        role: claims.role,
        namespace: normalize_namespace(Some(&claims.namespace)),
        protocol_version: if claims.protocol_version.trim().is_empty() {
            PROTOCOL_VERSION.to_string()
        } else {
            claims.protocol_version
        },
    })
}

pub fn verify_token_for_refresh(
    config: &RelayConfig,
    db: &RelayDb,
    token: &str,
) -> Result<TokenPayload, String> {
    if db.is_token_revoked(token)? {
        return Err("token revoked".to_string());
    }
    let mut validation = Validation::default();
    validation.set_issuer(&[ISSUER]);
    validation.leeway = 3600;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| "invalid or expired token".to_string())?;
    let claims = data.claims;
    Ok(TokenPayload {
        device_id: claims.device_id,
        session_id: claims.session_id,
        role: claims.role,
        namespace: normalize_namespace(Some(&claims.namespace)),
        protocol_version: if claims.protocol_version.trim().is_empty() {
            PROTOCOL_VERSION.to_string()
        } else {
            claims.protocol_version
        },
    })
}

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::db::RelayDb;
use super::protocol::{normalize_namespace, DEFAULT_NAMESPACE, PROTOCOL_VERSION};

const ISSUER: &str = "yuanio-relay";
const TOKEN_EXPIRY_SECONDS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone)]
pub struct JwtProvider {
    secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPayload {
    pub device_id: String,
    pub session_id: String,
    pub role: String,
    pub namespace: String,
    pub protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenClaims {
    device_id: String,
    session_id: String,
    role: String,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    protocol_version: Option<String>,
    exp: usize,
    iss: String,
    sub: String,
    iat: Option<usize>,
}

impl JwtProvider {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn sign_token(&self, payload: &TokenPayload) -> Result<String, String> {
        let namespace = normalize_namespace(Some(&payload.namespace));
        let protocol_version = if payload.protocol_version.trim().is_empty() {
            PROTOCOL_VERSION.to_string()
        } else {
            payload.protocol_version.clone()
        };
        let now = now_seconds();
        let claims = TokenClaims {
            device_id: payload.device_id.clone(),
            session_id: payload.session_id.clone(),
            role: payload.role.clone(),
            namespace: Some(namespace.clone()),
            protocol_version: Some(protocol_version),
            exp: (now + TOKEN_EXPIRY_SECONDS) as usize,
            iss: ISSUER.to_string(),
            sub: format!("{namespace}:{}", payload.device_id),
            iat: Some(now as usize),
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| e.to_string())
    }

    pub fn verify_token(&self, token: &str, db: &RelayDb) -> Result<TokenPayload, String> {
        self.verify_token_with_leeway(token, db, 0)
    }

    pub fn verify_token_with_leeway(
        &self,
        token: &str,
        db: &RelayDb,
        leeway_seconds: u64,
    ) -> Result<TokenPayload, String> {
        if db.is_token_revoked(token)? {
            return Err("invalid or expired token".to_string());
        }
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[ISSUER]);
        validation.leeway = leeway_seconds;
        let data = decode::<TokenClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map_err(|_| "invalid or expired token".to_string())?;

        let claims = data.claims;
        if claims.device_id.is_empty() || claims.session_id.is_empty() || claims.role.is_empty() {
            return Err("invalid or expired token".to_string());
        }
        Ok(TokenPayload {
            device_id: claims.device_id,
            session_id: claims.session_id,
            role: claims.role,
            namespace: normalize_namespace(claims.namespace.as_deref().or(Some(DEFAULT_NAMESPACE))),
            protocol_version: claims.protocol_version.unwrap_or_else(|| "0.0.0".to_string()),
        })
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

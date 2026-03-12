use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use p256::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
    PublicKey,
    SecretKey,
};
use rand::rngs::OsRng;
use sha2::Sha256;

pub const DEFAULT_E2EE_INFO: &str = "yuanio-e2ee-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyPair {
    pub public_key: String,
    pub private_key: String,
}

#[derive(Debug, Clone)]
pub struct DeriveKeyParams {
    pub private_key: String,
    pub public_key: String,
    pub salt: String,
    pub info: Option<String>,
}

pub fn generate_keypair() -> Result<KeyPair, String> {
    let secret = SecretKey::random(&mut OsRng);
    let public = secret.public_key();

    let private_der = secret
        .to_pkcs8_der()
        .map_err(|_| "pkcs8 encode failed".to_string())?;
    let public_der = public
        .to_public_key_der()
        .map_err(|_| "public key encode failed".to_string())?;

    Ok(KeyPair {
        public_key: general_purpose::STANDARD.encode(public_der.as_bytes()),
        private_key: general_purpose::STANDARD.encode(private_der.as_bytes()),
    })
}

pub fn derive_aes_key(params: DeriveKeyParams) -> Result<Vec<u8>, String> {
    let private_key = general_purpose::STANDARD
        .decode(params.private_key)
        .map_err(|e| format!("invalid private key: {e}"))?;
    let public_key = general_purpose::STANDARD
        .decode(params.public_key)
        .map_err(|e| format!("invalid public key: {e}"))?;

    let secret_key = SecretKey::from_pkcs8_der(&private_key)
        .map_err(|_| "invalid private key bytes".to_string())?;
    let peer = PublicKey::from_public_key_der(&public_key)
        .map_err(|_| "invalid public key bytes".to_string())?;

    let shared = p256::ecdh::diffie_hellman(secret_key.to_nonzero_scalar(), peer.as_affine());
    let hk = Hkdf::<Sha256>::new(Some(params.salt.as_bytes()), shared.raw_secret_bytes().as_slice());

    let mut okm = [0u8; 32];
    let info = params.info.unwrap_or_else(|| DEFAULT_E2EE_INFO.to_string());
    hk.expand(info.as_bytes(), &mut okm)
        .map_err(|_| "hkdf expand failed".to_string())?;

    Ok(okm.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_matches_for_both_sides() {
        let agent = generate_keypair().expect("generate agent keypair");
        let app = generate_keypair().expect("generate app keypair");
        let salt = "session-1".to_string();

        let agent_key = derive_aes_key(DeriveKeyParams {
            private_key: agent.private_key.clone(),
            public_key: app.public_key.clone(),
            salt: salt.clone(),
            info: None,
        })
        .expect("derive agent key");

        let app_key = derive_aes_key(DeriveKeyParams {
            private_key: app.private_key.clone(),
            public_key: agent.public_key.clone(),
            salt,
            info: None,
        })
        .expect("derive app key");

        assert_eq!(agent_key, app_key);
        assert_eq!(agent_key.len(), 32);
    }
}

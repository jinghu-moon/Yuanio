use chrono::{DateTime, Utc};
use rand::Rng;
use uuid::Uuid;

pub fn generate_pairing_code() -> String {
    let mut rng = rand::thread_rng();
    let mut part = || format!("{:03}", rng.gen_range(0..1000));
    format!("{}-{}", part(), part())
}

pub fn generate_device_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn is_expired(expires_at: &str) -> bool {
    let parsed = DateTime::parse_from_rfc3339(expires_at);
    match parsed {
        Ok(value) => value.with_timezone(&Utc) < Utc::now(),
        Err(_) => true,
    }
}

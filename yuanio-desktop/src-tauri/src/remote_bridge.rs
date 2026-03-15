use serde_json::Value;
use url::Url;

use crate::relay::protocol::{
    DeviceRole,
    WsFrame,
    WsHelloPayload,
    PROTOCOL_VERSION,
    MAX_ENVELOPE_BINARY_PAYLOAD_BYTES,
};

#[derive(Debug, Clone, Default)]
pub struct HelloOptions {
    pub protocol_version: Option<String>,
    pub namespace: Option<String>,
    pub device_id: Option<String>,
    pub role: Option<DeviceRole>,
    pub client_version: Option<String>,
}

pub fn build_ws_url(server_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(server_url).map_err(|e| format!("解析 server_url 失败: {e}"))?;
    let scheme = match url.scheme() {
        "https" | "wss" => "wss",
        _ => "ws",
    };
    url.set_scheme(scheme).map_err(|_| "设置 ws 协议失败".to_string())?;
    url.set_path("/relay-ws");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

pub fn build_hello_frame(token: &str, options: HelloOptions) -> WsFrame {
    let HelloOptions {
        protocol_version,
        namespace,
        device_id,
        role,
        client_version,
    } = options;
    let payload = WsHelloPayload {
        token: token.to_string(),
        protocol_version: Some(protocol_version.unwrap_or_else(|| PROTOCOL_VERSION.to_string())),
        namespace,
        device_id,
        role,
        client_version,
    };
    WsFrame::Hello(payload)
}

#[derive(Debug, Clone, PartialEq)]
pub enum NormalizedPayload {
    Text(String),
    Binary(Vec<u8>),
    Json(Value),
}

pub fn normalize_envelope_payload(value: &Value) -> Result<NormalizedPayload, String> {
    match value {
        Value::String(text) => Ok(NormalizedPayload::Text(text.clone())),
        Value::Object(map) => {
            let Some(Value::String(kind)) = map.get("type") else {
                return Ok(NormalizedPayload::Json(value.clone()));
            };
            if kind != "Buffer" {
                return Ok(NormalizedPayload::Json(value.clone()));
            }
            let Some(Value::Array(items)) = map.get("data") else {
                return Err("invalid buffer payload".to_string());
            };
            if items.len() > MAX_ENVELOPE_BINARY_PAYLOAD_BYTES {
                return Err(format!("binary payload too large (max {} bytes)", MAX_ENVELOPE_BINARY_PAYLOAD_BYTES));
            }
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                let Some(num) = item.as_u64() else {
                    return Err("invalid buffer payload".to_string());
                };
                if num > 255 {
                    return Err("invalid buffer payload".to_string());
                }
                bytes.push(num as u8);
            }
            Ok(NormalizedPayload::Binary(bytes))
        }
        _ => Ok(NormalizedPayload::Json(value.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::protocol::DeviceRole;
    use serde_json::json;

    #[test]
    fn ws_url_normalizes_scheme_and_path() {
        let url = build_ws_url("http://localhost:3000/api?x=1#hash").unwrap();
        assert_eq!(url.as_str(), "ws://localhost:3000/relay-ws");
        let url = build_ws_url("https://example.com/path").unwrap();
        assert_eq!(url.as_str(), "wss://example.com/relay-ws");
    }

    #[test]
    fn hello_frame_includes_defaults() {
        let frame = build_hello_frame("token-1", HelloOptions::default());
        let value = serde_json::to_value(frame).unwrap();
        assert_eq!(value, json!({
            "type": "hello",
            "data": {
                "token": "token-1",
                "protocolVersion": PROTOCOL_VERSION
            }
        }));
    }

    #[test]
    fn hello_frame_includes_overrides() {
        let frame = build_hello_frame("token-2", HelloOptions {
            protocol_version: Some("1.9.9".to_string()),
            namespace: Some("ns".to_string()),
            device_id: Some("dev-1".to_string()),
            role: Some(DeviceRole::App),
            client_version: Some("desktop-0.1".to_string()),
        });
        let value = serde_json::to_value(frame).unwrap();
        assert_eq!(value, json!({
            "type": "hello",
            "data": {
                "token": "token-2",
                "protocolVersion": "1.9.9",
                "namespace": "ns",
                "deviceId": "dev-1",
                "role": "app",
                "clientVersion": "desktop-0.1"
            }
        }));
    }

    #[test]
    fn normalize_payload_reads_text() {
        let value = Value::String("hello".to_string());
        let normalized = normalize_envelope_payload(&value).unwrap();
        assert_eq!(normalized, NormalizedPayload::Text("hello".to_string()));
    }

    #[test]
    fn normalize_payload_reads_buffer_json() {
        let value = json!({
            "type": "Buffer",
            "data": [1, 2, 3]
        });
        let normalized = normalize_envelope_payload(&value).unwrap();
        assert_eq!(normalized, NormalizedPayload::Binary(vec![1, 2, 3]));
    }

    #[test]
    fn normalize_payload_rejects_invalid_buffer() {
        let value = json!({
            "type": "Buffer",
            "data": [-1, 300]
        });
        assert!(normalize_envelope_payload(&value).is_err());
    }
}

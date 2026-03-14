use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
};

use crate::{
    daemon_state::{read_state, remove_state_file, resolve_state_path},
    keystore::load_keys,
};

const PROTOCOL_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub checks: Vec<DoctorCheck>,
    pub failed: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorRequest {
    pub control_server_url: String,
    pub public_server_url: Option<String>,
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn check_command(name: &str, cmd: &str) -> DoctorCheck {
    match Command::new(cmd).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().unwrap_or("unknown").trim();
            DoctorCheck {
                label: format!("{name} CLI"),
                ok: true,
                detail: version.to_string(),
            }
        }
        _ => DoctorCheck {
            label: format!("{name} CLI"),
            ok: false,
            detail: "not found".to_string(),
        },
    }
}

fn check_proxy_env() -> DoctorCheck {
    let keys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
    let mut active = Vec::new();
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                active.push(format!("{key}={value}"));
            }
        }
    }
    if active.is_empty() {
        DoctorCheck {
            label: "Proxy".to_string(),
            ok: true,
            detail: "not set".to_string(),
        }
    } else {
        DoctorCheck {
            label: "Proxy".to_string(),
            ok: false,
            detail: active.join("; "),
        }
    }
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

fn check_disk() -> DoctorCheck {
    let dir = resolve_base_dir();
    if !dir.exists() {
        return DoctorCheck {
            label: "Disk".to_string(),
            ok: true,
            detail: "0 bytes".to_string(),
        };
    }
    let mut total: u64 = 0;
    let mut stack = vec![dir];
    while let Some(path) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(meta) = entry.metadata() {
                    if meta.is_dir() {
                        stack.push(path);
                    } else {
                        total = total.saturating_add(meta.len());
                    }
                }
            }
        }
    }
    let mb = (total as f64) / (1024.0 * 1024.0);
    DoctorCheck {
        label: "Disk".to_string(),
        ok: true,
        detail: format!("{:.1}MB used", mb),
    }
}

fn check_keys() -> DoctorCheck {
    match load_keys() {
        Ok(Some(session)) => {
            let keys = &session.keys;
            let required = [
                ("sessionToken", keys.session_token.as_str()),
                ("secretKey", keys.private_key.as_str()),
                ("peerPublicKey", keys.peer_public_key.as_str()),
            ];
            let missing: Vec<String> = required
                .into_iter()
                .filter(|(_, value)| value.trim().is_empty())
                .map(|(name, _)| name.to_string())
                .collect();
            if missing.is_empty() {
                DoctorCheck {
                    label: "Keys".to_string(),
                    ok: true,
                    detail: "valid".to_string(),
                }
            } else {
                DoctorCheck {
                    label: "Keys".to_string(),
                    ok: false,
                    detail: format!("incomplete keystore ({})", missing.join(",")),
                }
            }
        }
        Ok(None) => DoctorCheck {
            label: "Keys".to_string(),
            ok: false,
            detail: "keystore not found".to_string(),
        },
        Err(_) => DoctorCheck {
            label: "Keys".to_string(),
            ok: false,
            detail: "corrupted keystore".to_string(),
        },
    }
}

fn check_daemon() -> (DoctorCheck, Option<DoctorCheck>) {
    let Some(state) = read_state() else {
        return (
            DoctorCheck {
                label: "Daemon".to_string(),
                ok: false,
                detail: "not running".to_string(),
            },
            None,
        );
    };
    if pid_exists(state.pid) {
        return (
            DoctorCheck {
                label: "Daemon".to_string(),
                ok: true,
                detail: format!("PID={} port={}", state.pid, state.port),
            },
            None,
        );
    }

    let cleanup = if resolve_state_path().exists() {
        remove_state_file().ok();
        Some(DoctorCheck {
            label: "Cleanup".to_string(),
            ok: true,
            detail: "stale daemon state removed".to_string(),
        })
    } else {
        None
    };

    (
        DoctorCheck {
            label: "Daemon".to_string(),
            ok: false,
            detail: "not running (stale state)".to_string(),
        },
        cleanup,
    )
}

fn pid_exists(pid: u32) -> bool {
    if std::env::consts::OS != "windows" {
        return true;
    }
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid)])
        .output();
    let Ok(output) = output else {
        return false;
    };
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if text.contains("No tasks are running") {
        return false;
    }
    text.contains(&pid.to_string())
}

fn check_cloudflared_binary() -> DoctorCheck {
    match Command::new("cloudflared").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().unwrap_or("unknown").trim();
            DoctorCheck {
                label: "Cloudflared".to_string(),
                ok: true,
                detail: version.to_string(),
            }
        }
        _ => DoctorCheck {
            label: "Cloudflared".to_string(),
            ok: false,
            detail: "not found".to_string(),
        },
    }
}

fn check_cloudflared_service_windows() -> Option<DoctorCheck> {
    if std::env::consts::OS != "windows" {
        return None;
    }
    match Command::new("sc").args(["query", "cloudflared"]).output() {
        Ok(output) => {
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if text.contains("1060") || text.to_lowercase().contains("does not exist") {
                return Some(DoctorCheck {
                    label: "CF Service".to_string(),
                    ok: false,
                    detail: "not installed".to_string(),
                });
            }
            if text.contains("RUNNING") {
                return Some(DoctorCheck {
                    label: "CF Service".to_string(),
                    ok: true,
                    detail: "running".to_string(),
                });
            }
            if text.contains("STOPPED") {
                return Some(DoctorCheck {
                    label: "CF Service".to_string(),
                    ok: false,
                    detail: "stopped".to_string(),
                });
            }
            Some(DoctorCheck {
                label: "CF Service".to_string(),
                ok: false,
                detail: "unknown state".to_string(),
            })
        }
        Err(_) => Some(DoctorCheck {
            label: "CF Service".to_string(),
            ok: false,
            detail: "query failed".to_string(),
        }),
    }
}

fn is_likely_ip(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

fn extract_ips(text: &str) -> HashSet<IpAddr> {
    let mut ips = HashSet::new();
    for token in text.split(|c: char| !c.is_ascii_hexdigit() && c != '.' && c != ':') {
        if token.is_empty() {
            continue;
        }
        if let Ok(ip) = token.parse::<IpAddr>() {
            ips.insert(ip);
        }
    }
    ips
}

fn resolve_host_by_nslookup(host: &str, server: Option<&str>) -> Result<HashSet<IpAddr>, String> {
    let mut cmd = Command::new("nslookup");
    cmd.arg(host);
    if let Some(server) = server {
        cmd.arg(server);
    }
    let output = cmd.output().map_err(|_| "nslookup not available".to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}");
    let ips = extract_ips(&combined);
    Ok(ips)
}

fn check_public_dns(public_server_url: &str) -> Option<DoctorCheck> {
    let host = match reqwest::Url::parse(public_server_url) {
        Ok(url) => url.host_str().map(|value| value.to_string()),
        Err(_) => None,
    }?;

    if host.is_empty() || host == "localhost" || is_likely_ip(&host) {
        return Some(DoctorCheck {
            label: "DNS".to_string(),
            ok: true,
            detail: "skipped (localhost/ip)".to_string(),
        });
    }

    let system_ips = resolve_host_by_nslookup(&host, None).unwrap_or_default();
    let public_ips = resolve_host_by_nslookup(&host, Some("1.1.1.1")).unwrap_or_default();

    if public_ips.is_empty() {
        return Some(DoctorCheck {
            label: "DNS".to_string(),
            ok: false,
            detail: format!("public resolver failed ({host})"),
        });
    }
    if system_ips.is_empty() {
        return Some(DoctorCheck {
            label: "DNS".to_string(),
            ok: false,
            detail: format!("system resolver failed ({host})"),
        });
    }

    let overlap = system_ips.iter().filter(|ip| public_ips.contains(ip)).count();
    let system_text = system_ips.iter().take(3).map(|ip| ip.to_string()).collect::<Vec<_>>().join(",");
    let public_text = public_ips.iter().take(3).map(|ip| ip.to_string()).collect::<Vec<_>>().join(",");

    if overlap == 0 {
        return Some(DoctorCheck {
            label: "DNS".to_string(),
            ok: false,
            detail: format!("mismatch system=[{system_text}] public=[{public_text}]"),
        });
    }

    Some(DoctorCheck {
        label: "DNS".to_string(),
        ok: true,
        detail: format!("aligned ({host})"),
    })
}

fn check_url_reachability(label: &str, url: &str, client: &Client) -> DoctorCheck {
    let health = format!("{}/health", url.trim_end_matches('/'));
    match client.get(health).send() {
        Ok(res) if res.status().is_success() => DoctorCheck {
            label: label.to_string(),
            ok: true,
            detail: format!("connected ({url})"),
        },
        Ok(res) => DoctorCheck {
            label: label.to_string(),
            ok: false,
            detail: format!("HTTP {} ({url})", res.status()),
        },
        Err(err) => DoctorCheck {
            label: label.to_string(),
            ok: false,
            detail: format!("{} ({url})", err),
        },
    }
}

fn check_protocol(control_url: &str, client: &Client) -> DoctorCheck {
    let health = format!("{}/health", control_url.trim_end_matches('/'));
    let res = client.get(health).send();
    let Ok(res) = res else {
        return DoctorCheck {
            label: "Protocol".to_string(),
            ok: false,
            detail: "check failed".to_string(),
        };
    };
    if !res.status().is_success() {
        return DoctorCheck {
            label: "Protocol".to_string(),
            ok: false,
            detail: format!("health HTTP {}", res.status()),
        };
    }
    let payload: Value = res.json().unwrap_or(Value::Null);
    let server_version = payload
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if server_version.is_empty() {
        return DoctorCheck {
            label: "Protocol".to_string(),
            ok: true,
            detail: "legacy relay (version unknown)".to_string(),
        };
    }
    let client_major = PROTOCOL_VERSION.split('.').next().unwrap_or("");
    let server_major = server_version.split('.').next().unwrap_or("");
    if client_major != server_major {
        return DoctorCheck {
            label: "Protocol".to_string(),
            ok: false,
            detail: format!("major mismatch cli={} relay={}", PROTOCOL_VERSION, server_version),
        };
    }
    DoctorCheck {
        label: "Protocol".to_string(),
        ok: true,
        detail: format!("compatible cli={} relay={}", PROTOCOL_VERSION, server_version),
    }
}

#[tauri::command]
pub fn doctor_run(payload: DoctorRequest) -> Result<DoctorReport, String> {
    let control = payload.control_server_url.trim().to_string();
    if control.is_empty() {
        return Err("controlServerUrl 为空".to_string());
    }
    let client = http_client()?;
    let mut checks = vec![
        check_command("Claude", "claude"),
        check_command("Codex", "codex"),
        check_command("Gemini", "gemini"),
        check_url_reachability("Relay(control)", &control, &client),
        check_protocol(&control, &client),
    ];

    if let Some(public_url) = payload.public_server_url {
        let public = public_url.trim().to_string();
        if !public.is_empty() && public != control {
            checks.push(check_url_reachability("Relay(public)", &public, &client));
        }
        if let Some(dns_check) = check_public_dns(&public) {
            checks.push(dns_check);
        }
    }

    checks.push(check_proxy_env());
    checks.push(check_keys());
    let (daemon_check, cleanup_check) = check_daemon();
    checks.push(daemon_check);
    if let Some(cleanup) = cleanup_check {
        checks.push(cleanup);
    }
    checks.push(check_disk());
    checks.push(check_cloudflared_binary());
    if let Some(service) = check_cloudflared_service_windows() {
        checks.push(service);
    }

    let failed = checks.iter().filter(|item| !item.ok).count();
    Ok(DoctorReport { checks, failed })
}

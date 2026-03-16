use std::net::{Ipv4Addr, UdpSocket};

use get_if_addrs::{get_if_addrs, IfAddr};

pub fn local_ipv4_address() -> Option<String> {
    if let Some(ip) = pick_interface_ipv4() {
        return Some(ip.to_string());
    }
    fallback_ipv4().map(|ip| ip.to_string())
}

fn pick_interface_ipv4() -> Option<Ipv4Addr> {
    let interfaces = get_if_addrs().ok()?;
    let mut private = Vec::new();
    let mut cgnat = Vec::new();
    let mut other = Vec::new();

    for iface in interfaces {
        let ip = match iface.addr {
            IfAddr::V4(v4) => v4.ip,
            _ => continue,
        };
        if is_unusable_ipv4(ip) {
            continue;
        }
        if ip.is_private() {
            private.push(ip);
        } else if is_cgnat_ipv4(ip) {
            cgnat.push(ip);
        } else {
            other.push(ip);
        }
    }

    private.into_iter().next().or_else(|| cgnat.into_iter().next()).or_else(|| other.into_iter().next())
}

fn fallback_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    match addr {
        std::net::SocketAddr::V4(v4) => {
            let ip = *v4.ip();
            if is_unusable_ipv4(ip) {
                None
            } else {
                Some(ip)
            }
        }
        _ => None,
    }
}

fn is_unusable_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_link_local()
        || is_benchmark_ipv4(ip)
}

fn is_benchmark_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 198 && (b == 18 || b == 19)
}

fn is_cgnat_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 100 && (64..=127).contains(&b)
}

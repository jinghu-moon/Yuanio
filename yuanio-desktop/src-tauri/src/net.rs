use std::net::UdpSocket;

pub fn local_ipv4_address() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    match addr {
        std::net::SocketAddr::V4(v4) => Some(v4.ip().to_string()),
        _ => None,
    }
}

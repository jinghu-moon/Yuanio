FROM rust:1.77 AS builder
WORKDIR /app

COPY crates/relay-protocol/Cargo.toml crates/relay-protocol/Cargo.toml
COPY crates/relay-server/Cargo.toml crates/relay-server/Cargo.toml
COPY crates/relay-server/Cargo.lock crates/relay-server/Cargo.lock

COPY crates/relay-protocol/src crates/relay-protocol/src
COPY crates/relay-server/src crates/relay-server/src

RUN cargo build --release --manifest-path crates/relay-server/Cargo.toml

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/crates/relay-server/target/release/relay-server /usr/local/bin/relay-server

EXPOSE 3000
CMD ["relay-server"]

# Yuanio

[![Release](https://img.shields.io/github/v/release/jinghu-moon/Yuanio?display_name=tag)](https://github.com/jinghu-moon/Yuanio/releases)
[![License](https://img.shields.io/github/license/jinghu-moon/Yuanio)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white)](android-app/)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)](https://bun.sh/)

Remote-first Android control for local AI coding agents and developer workflows.

Yuanio lets you monitor, continue, and manage local coding sessions from your phone or tablet. It connects an Android client, a Bun-based relay server, and a local CLI/daemon layer so desktop agent workflows are no longer tied to a single desk, terminal, or network environment.

## Why Yuanio

- Keep long-running coding sessions visible when you step away from the keyboard.
- Review approvals, diffs, logs, and terminal output from Android.
- Bridge desktop agents and mobile control through a relay-friendly architecture.
- Support remote-first workflows instead of assuming a fixed local environment.

## Current scope

Yuanio is currently focused on Android-based remote control for local developer workflows, including chat-style interaction, approval handling, relay transport, terminal surfaces, and session lifecycle management.

Today the repository is optimized for fast iteration rather than polished public packaging, but the codebase already contains the main end-to-end foundations for an open remote coding companion.

## Status

This repository is being prepared for a public GitHub release.

The public app repository intentionally excludes local secrets, runtime state, build outputs, and most large third-party reference mirrors that were used during research and prototyping.

## Repository contents

- `android-app/` - Android application built with Kotlin and Jetpack Compose.
- `packages/cli/` - local CLI launcher, TUI entrypoint, and desktop-side control flow.
- `packages/relay-server/` - Bun relay server for encrypted forwarding and coordination.
- `packages/shared/` - shared protocol, crypto, and transport primitives.
- `packages/web-dashboard/` - experimental web dashboard surfaces.
- `docs/` - architecture, protocol, deployment, benchmarking, and workflow notes.
- `tools/` - maintenance scripts such as icon validation helpers.

## Key capabilities

- Remote session monitoring from Android.
- Approval and diff review flows for agent actions.
- Relay-based encrypted transport between mobile and desktop.
- Local/remote session handoff patterns.
- Android terminal and chat-oriented interaction surfaces.
- Shared protocol evolution across Android, CLI, and relay layers.

## Repository layout

```text
android-app/            Android client
packages/cli/           local CLI and launch flow
packages/relay-server/  relay server
packages/shared/        shared protocol and crypto
packages/web-dashboard/ web dashboard experiments
scripts/                local helper scripts
tools/                  maintenance utilities
```

## Quick start

### Prerequisites

- Bun
- Node.js
- Java 17+
- Android SDK / Android Studio

### Install dependencies

```bash
bun install
```

### Common commands

```bash
bun run launch
bun run typecheck
bun run check:tabler-icons
bun run check:tabler-icons:fix
bun run android:build:debug
bun run android:install:debug
```

### Android debug build

```bash
cd android-app
./gradlew assembleDebug --console=plain
```

## Documentation

- `docs/architecture.md`
- `docs/protocol.md`
- `docs/security.md`
- `docs/task-checklist.md`
- `docs/deploy-cloudflare-tunnel.md`
- `docs/fdroid-release.md`
- `refer/yuanio-mobile-comprehensive-blueprint.md`
- `refer/yuanio-mobile-phase-checklist-v2.1.1.md`

## Public release boundaries

The public repository intentionally excludes classes of local-only materials such as:

- signing materials and private service configuration
- local databases and runtime state
- local AI agent caches and working memory
- logs, screenshots, temporary captures, and crash dumps
- most large third-party source mirrors and archive snapshots under `refer/`

See `.gitignore` and `THIRD_PARTY.md` for attribution and boundary details.

## Non-goals for now

- Full cloud-hosted SaaS positioning
- Multi-platform client parity beyond Android
- Release-process polish over development velocity
- Public redistribution of every research mirror used during prototyping

## License

This project is licensed under the GNU Affero General Public License, version 3 or any later version (`AGPL-3.0-or-later`).

See `LICENSE`.

## Third-party materials

Some files in this repository are derived from or synchronized with third-party open-source projects.

See `THIRD_PARTY.md` for attribution and boundary notes.

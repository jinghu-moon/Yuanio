# Yuanio

Remote-first mobile control for local AI coding workflows.

Yuanio connects an Android app, a Bun-based relay server, and a local CLI/daemon layer so you can monitor, continue, and manage coding sessions from a phone or tablet.

## Status

This repository is being prepared for a public GitHub release.

The public app repository intentionally excludes local secrets, runtime state, build outputs, and most large third-party reference mirrors that were used during research and prototyping.

## What is in this repository

- `android-app/` - Android application built with Kotlin and Jetpack Compose.
- `packages/cli/` - local CLI launcher and session entrypoint.
- `packages/relay-server/` - Bun relay server for encrypted message forwarding.
- `packages/shared/` - shared protocol and crypto utilities.
- `docs/` - architecture, protocol, deployment, benchmarking, and design notes.
- `tools/` - small local maintenance scripts, including icon validation.

## Key capabilities

- Remote session monitoring from Android.
- Approval and diff review flows for agent actions.
- Relay-based encrypted transport between mobile and desktop.
- Local/remote session handoff model.
- Android terminal and chat-oriented interaction surfaces.

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

### Workspace prerequisites

- Bun
- Node.js
- Java 17+
- Android SDK / Android Studio (for Android builds)

### Install dependencies

```bash
bun install
```

### Useful commands

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

The following classes of local files are intentionally excluded from the public repository:

- signing materials and local Firebase config
- local databases and runtime state
- local AI agent caches and working memory
- logs, screenshots, temporary captures, and crash dumps
- large third-party source mirrors and archive snapshots under `refer/`

See `.gitignore` and `THIRD_PARTY.md` for details.

## License

This project is licensed under the GNU Affero General Public License, version 3 or any later version (`AGPL-3.0-or-later`).

See `LICENSE`.

## Third-party materials

Some files in this repository are derived from or synchronized with third-party open-source projects.

See `THIRD_PARTY.md` for attribution and boundary notes.

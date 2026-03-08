# Third-Party Materials

This document describes the main third-party source relationships relevant to the public Yuanio repository.

## Scope

- The Yuanio project code in this repository is licensed separately under `AGPL-3.0-or-later`.
- Third-party works keep their own licenses.
- Nothing in this document relicenses third-party code under AGPL.

## Included third-party-derived assets

### Tabler icon drawables used by the Android app

The following local drawable files are synchronized from the `compose-icons` Android Tabler outline set:

- `android-app/app/src/main/res/drawable/ic_tb_alert_triangle.xml`
- `android-app/app/src/main/res/drawable/ic_tb_chevron_down.xml`
- `android-app/app/src/main/res/drawable/ic_tb_chevron_up.xml`
- `android-app/app/src/main/res/drawable/ic_tb_folder.xml`
- `android-app/app/src/main/res/drawable/ic_tb_message_circle.xml`
- `android-app/app/src/main/res/drawable/ic_tb_settings.xml`
- `android-app/app/src/main/res/drawable/ic_tb_sparkles.xml`
- `android-app/app/src/main/res/drawable/ic_tb_terminal_2.xml`

Local synchronization and validation are documented in:

- `tools/check_tabler_icons.py`
- `android-app/app/src/main/README.AI.md`

Reference source used during development:

- `refer/compose-icons-main/icons-tabler-outline-android/src/main/res/drawable`

Reference project license on disk:

- `refer/compose-icons-main/LICENSE`

At the time of writing, that reference license is `MIT`.

## Excluded local reference materials

The local development workspace contains additional research/reference materials under `refer/` and `seeyue-workflows/`.

Most of those mirrors, archives, and source snapshots are intentionally excluded from the public GitHub repository via `.gitignore` because:

- they are not part of the core Yuanio application codebase
- they may carry independent licenses and attribution requirements
- they significantly increase repository size and legal review surface area

If any excluded reference project is later copied into the public repository, its original license and attribution requirements must be preserved.

## Dependency note

Package-managed dependencies pulled by Bun, npm, Gradle, or Android tooling are governed by their own upstream licenses. Review lockfiles, Gradle metadata, and published dependency manifests before any commercial or redistributed release.

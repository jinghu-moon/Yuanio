# Tabler Drawable Icons

> **Type**: `Module`
> **Status**: `Stable`
> **Responsibility**: Maintain the small in-repo set of Tabler outline drawable assets used by the Android glyph layer.

## Context

- **Problem**: The app needs a small number of Tabler icons without adding a full icon dependency.
- **Role**: This folder provides local `R.drawable.ic_tb_*` assets consumed by the Android UI glyph mapping.
- **Split status**: Focused.
- **Collaborators**:
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt:20`
  - `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt:75`
  - `refer/compose-icons-main/icons-tabler-outline-android/src/main/res/drawable`

## Architecture

```text
ActionGlyph enum
  -> actionGlyphRes(...)
  -> local drawable resource `ic_tb_*`
  -> Compose `Icon(painterResource(...))`
```

### Inventory

| Local asset | Used by | Reference source |
|---|---|---|
| `ic_tb_message_circle.xml` | `ActionGlyph.CHAT` | `tabler_ic_message_circle_outline.xml` |
| `ic_tb_terminal_2.xml` | `ActionGlyph.TERMINAL` | `tabler_ic_terminal_2_outline.xml` |
| `ic_tb_folder.xml` | `ActionGlyph.FILES` | `tabler_ic_folder_outline.xml` |
| `ic_tb_sparkles.xml` | `ActionGlyph.SKILLS` | `tabler_ic_sparkles_outline.xml` |
| `ic_tb_settings.xml` | `ActionGlyph.SETTINGS` | `tabler_ic_settings_outline.xml` |
| `ic_tb_alert_triangle.xml` | `ActionGlyph.WARNING` | `tabler_ic_alert_triangle_outline.xml` |
| `ic_tb_chevron_down.xml` | `ActionGlyph.CHEVRON_DOWN` | `tabler_ic_chevron_down_outline.xml` |
| `ic_tb_chevron_up.xml` | `ActionGlyph.CHEVRON_UP` | `tabler_ic_chevron_up_outline.xml` |

## Interface Schema

### Public contract

- `ActionGlyph` is the only logical icon contract exposed to callers: `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt:20`
- `actionGlyphRes(...)` is the only resource mapping entry point: `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt:75`
- Callers must use `ActionGlyphIcon(...)` or `actionGlyphRes(...)` instead of referencing `ic_tb_*` directly unless they are inside the glyph layer.

### Naming convention

- Local file name format: `ic_tb_<tabler_name>.xml`
- Source file format in reference repo: `tabler_ic_<tabler_name>_outline.xml`
- Local names intentionally stay short and stable for app code.

## Constraints

- MUST keep these assets local unless the project genuinely needs a large Tabler surface area.
- MUST use Tabler outline assets as the visual source of truth.
- MUST copy from `refer/compose-icons-main` first; do not hand-draw approximate paths when an upstream file already exists.
- MUST preserve `24dp` width/height and `24x24` viewport.
- MUST keep file formatting consistent with the reference repo style:
  - no XML declaration
  - 4-space indentation
  - `strokeWidth="2.0"`
  - LF line endings
- MUST update `BrandIcons.kt` when adding a new logical glyph.

## Logic & Behavior

### Add a new Tabler icon

1. Find the matching outline drawable in `refer/compose-icons-main/icons-tabler-outline-android/src/main/res/drawable`.
2. Copy the upstream file into this folder.
3. Rename it from `tabler_ic_<name>_outline.xml` to `ic_tb_<name>.xml`.
4. Add or extend the logical enum entry in `BrandIcons.kt`.
5. Update `actionGlyphRes(...)` mapping.
6. Run `cd android-app && ./gradlew assembleDebug --console=plain`.
7. Run `bun run check:tabler-icons` to verify local drawables still match the reference repo.
8. Run `bun run check:tabler-icons:fix` to restore missing or mismatched local drawables from the reference repo.
9. If you use Git locally, run `git config core.hooksPath .githooks` once to enable the bundled `pre-commit` check.
10. CI also runs the same validation in `.github/workflows/ci.yml`.
11. If you prefer, the direct Python entrypoints remain available too.

### Replace an existing icon path

- Replace only with the upstream-equivalent Tabler asset.
- Do not change the local filename unless the logical glyph name changes too.
- Keep downstream call sites unchanged whenever possible.

## Dependencies

| Type | Target | Purpose |
|---|---|---|
| Internal | `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt` | Logical glyph mapping |
| Internal | UI components using `ActionGlyphIcon(...)` | Render action icons |
| Reference-only | `refer/compose-icons-main` | Upstream Tabler Android drawable source |
| Runtime | None | No extra icon dependency is linked into the app |

## Patterns

### Preferred usage

```kotlin
ActionGlyphIcon(
    glyph = ActionGlyph.SETTINGS,
    contentDescription = null,
)
```

### Validation

- `bun run check:tabler-icons`
- `bun run check:tabler-icons:fix`
- `python tools/check_tabler_icons.py`
- `python tools/check_tabler_icons.py --fix`
- `git config core.hooksPath .githooks`
- `cd android-app && ./gradlew assembleDebug --console=plain`

### Anti-patterns

- Adding `com.composables:icons-tabler-*` only to use a handful of icons.
- Editing vector path data manually when the same icon already exists in `refer/compose-icons-main`.
- Referencing `R.drawable.ic_tb_*` across many call sites instead of going through `ActionGlyph`.

## Source Manifest

```yaml
source_manifest:
  schema: 1
  generated_at: 2026-03-08
  files:
    - path: android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt
      fingerprint: logical-action-glyph-mapping
    - path: android-app/app/src/main/res/drawable/ic_tb_message_circle.xml
      fingerprint: tabler-message-circle-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_terminal_2.xml
      fingerprint: tabler-terminal-2-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_folder.xml
      fingerprint: tabler-folder-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_sparkles.xml
      fingerprint: tabler-sparkles-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_settings.xml
      fingerprint: tabler-settings-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_alert_triangle.xml
      fingerprint: tabler-alert-triangle-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_chevron_down.xml
      fingerprint: tabler-chevron-down-outline-local
    - path: android-app/app/src/main/res/drawable/ic_tb_chevron_up.xml
      fingerprint: tabler-chevron-up-outline-local
    - path: refer/compose-icons-main/icons-tabler-outline-android/src/main/res/drawable
      fingerprint: upstream-reference-directory
```

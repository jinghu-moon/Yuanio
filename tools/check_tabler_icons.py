#!/usr/bin/env python3
from __future__ import annotations

import argparse
import difflib
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DIR = REPO_ROOT / "android-app" / "app" / "src" / "main" / "res" / "drawable"
REFERENCE_DIR = (
    REPO_ROOT
    / "refer"
    / "compose-icons-main"
    / "icons-tabler-outline-android"
    / "src"
    / "main"
    / "res"
    / "drawable"
)

ICON_MAP = {
    "ic_tb_alert_triangle.xml": "tabler_ic_alert_triangle_outline.xml",
    "ic_tb_chevron_down.xml": "tabler_ic_chevron_down_outline.xml",
    "ic_tb_chevron_up.xml": "tabler_ic_chevron_up_outline.xml",
    "ic_tb_folder.xml": "tabler_ic_folder_outline.xml",
    "ic_tb_message_circle.xml": "tabler_ic_message_circle_outline.xml",
    "ic_tb_settings.xml": "tabler_ic_settings_outline.xml",
    "ic_tb_sparkles.xml": "tabler_ic_sparkles_outline.xml",
    "ic_tb_terminal_2.xml": "tabler_ic_terminal_2_outline.xml",
}


@dataclass(frozen=True)
class IconPair:
    local_name: str
    reference_name: str

    @property
    def local_path(self) -> Path:
        return LOCAL_DIR / self.local_name

    @property
    def reference_path(self) -> Path:
        return REFERENCE_DIR / self.reference_name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate local Tabler drawables against the compose-icons reference repo."
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="overwrite missing or mismatched local drawables from the reference repo",
    )
    return parser.parse_args()


def read_normalized(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()


def read_reference_content(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").rstrip() + "\n"


def unified_diff(local_name: str, local_text: str, reference_name: str, reference_text: str) -> str:
    lines = difflib.unified_diff(
        reference_text.splitlines(),
        local_text.splitlines(),
        fromfile=reference_name,
        tofile=local_name,
        lineterm="",
    )
    return "\n".join(lines)


def write_from_reference(pair: IconPair) -> None:
    pair.local_path.write_text(
        read_reference_content(pair.reference_path),
        encoding="utf-8",
        newline="\n",
    )


def iter_pairs() -> list[IconPair]:
    return [IconPair(local_name, reference_name) for local_name, reference_name in ICON_MAP.items()]


def validate_directories() -> int | None:
    if not LOCAL_DIR.exists():
        print(f"[error] local drawable dir missing: {LOCAL_DIR}")
        return 2
    if not REFERENCE_DIR.exists():
        print(f"[error] reference drawable dir missing: {REFERENCE_DIR}")
        return 2
    return None


def main() -> int:
    args = parse_args()
    exit_code = validate_directories()
    if exit_code is not None:
        return exit_code

    print("[check] validating local Tabler drawables against compose-icons reference")
    print(f"[check] local dir: {LOCAL_DIR}")
    print(f"[check] reference dir: {REFERENCE_DIR}")
    if args.fix:
        print("[mode] fix enabled")

    errors: list[str] = []
    fixed_count = 0

    for pair in iter_pairs():
        local_path = pair.local_path
        reference_path = pair.reference_path

        if not reference_path.exists():
            errors.append(f"missing reference icon: {reference_path}")
            continue

        if not local_path.exists():
            if args.fix:
                write_from_reference(pair)
                fixed_count += 1
                print(f"[fix] restored missing {pair.local_name} from {pair.reference_name}")
            else:
                errors.append(f"missing local icon: {local_path}")
                continue

        local_text = read_normalized(local_path)
        reference_text = read_normalized(reference_path)

        if local_text != reference_text:
            if args.fix:
                write_from_reference(pair)
                fixed_count += 1
                local_text = read_normalized(local_path)
                if local_text == reference_text:
                    print(f"[fix] synced {pair.local_name} from {pair.reference_name}")
                    continue
                errors.append(
                    f"sync failed: {pair.local_name} != {pair.reference_name} after --fix"
                )
                continue

            diff = unified_diff(pair.local_name, local_text, pair.reference_name, reference_text)
            errors.append(
                f"content mismatch: {pair.local_name} != {pair.reference_name}\n{diff}"
            )
        else:
            print(f"[ok] {pair.local_name} == {pair.reference_name}")

    if errors:
        print(f"[fail] {len(errors)} issue(s) found")
        for error in errors:
            print("-" * 80)
            print(error)
        return 1

    if args.fix:
        print(f"[pass] {len(ICON_MAP)} icon(s) validated, fixed {fixed_count} file(s)")
    else:
        print(f"[pass] {len(ICON_MAP)} icon(s) validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())

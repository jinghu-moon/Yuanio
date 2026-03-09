#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GUARD_SCRIPTS = (
    REPO_ROOT / "tools" / "check_android_architecture.py",
    REPO_ROOT / "tools" / "check_android_deferred_reentry.py",
)


def run_guard(script_path: Path) -> int:
    print(f"[run] {script_path.relative_to(REPO_ROOT).as_posix()}")
    completed = subprocess.run([sys.executable, str(script_path)], cwd=REPO_ROOT)
    return completed.returncode


def main() -> int:
    for script_path in GUARD_SCRIPTS:
        exit_code = run_guard(script_path)
        if exit_code != 0:
            print(f"[fail] Android guard suite aborted at {script_path.name}")
            return exit_code

    print("[pass] Android guard suite passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

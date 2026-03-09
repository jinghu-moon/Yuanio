#!/usr/bin/env python3
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ANDROID_SRC_ROOT = REPO_ROOT / "android-app" / "app" / "src"
ANDROID_MAIN_JAVA = ANDROID_SRC_ROOT / "main" / "java"

FORBIDDEN_PATTERNS = {
    "Hilt 注解 @HiltAndroidApp": ("@HiltAndroidApp",),
    "Hilt 注解 @AndroidEntryPoint": ("@AndroidEntryPoint",),
    "Hilt 注解 @HiltViewModel": ("@HiltViewModel",),
    "Compose hiltViewModel()": ("hiltViewModel(",),
    "Hilt 包导入 dagger.hilt": ("dagger.hilt",),
    "已废弃架构名 GlobalSessionManager": ("GlobalSessionManager",),
}

ALLOWED_DEFAULT_SESSION_GATEWAY_PATHS = {
    "android-app/app/src/main/java/com/yuanio/app/YuanioApp.kt",
}


@dataclass(frozen=True)
class Violation:
    path: Path
    line_number: int
    reason: str
    line_text: str

    def format(self) -> str:
        relative_path = self.path.relative_to(REPO_ROOT).as_posix()
        return f"{relative_path}:{self.line_number}: {self.reason}\n    {self.line_text.strip()}"


def iter_source_files() -> list[Path]:
    return sorted(
        path
        for path in ANDROID_SRC_ROOT.rglob("*")
        if path.is_file() and path.suffix in {".kt", ".kts", ".java"}
    )


def collect_forbidden_pattern_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in iter_source_files():
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            for reason, patterns in FORBIDDEN_PATTERNS.items():
                if any(pattern in line for pattern in patterns):
                    violations.append(Violation(path, line_number, reason, line))
    return violations


def collect_default_session_gateway_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in sorted(ANDROID_MAIN_JAVA.rglob("*.kt")):
        text = path.read_text(encoding="utf-8")
        relative_path = path.relative_to(REPO_ROOT).as_posix()
        for line_number, line in enumerate(text.splitlines(), start=1):
            if "DefaultSessionGateway(" not in line:
                continue
            if "class DefaultSessionGateway(" in line:
                continue
            if relative_path in ALLOWED_DEFAULT_SESSION_GATEWAY_PATHS:
                continue
            violations.append(
                Violation(
                    path,
                    line_number,
                    "DefaultSessionGateway 只允许在 YuanioApp 中作为共享实例创建",
                    line,
                )
            )
    return violations


def main() -> int:
    if not ANDROID_SRC_ROOT.exists():
        print(f"[error] Android source root missing: {ANDROID_SRC_ROOT}")
        return 2

    violations = [
        *collect_forbidden_pattern_violations(),
        *collect_default_session_gateway_violations(),
    ]

    if violations:
        print(f"[fail] Android architecture guard found {len(violations)} violation(s)")
        for violation in violations:
            print(f"- {violation.format()}")
        return 1

    print("[pass] Android architecture guard passed")
    print("[pass] Hilt remains excluded")
    print("[pass] GlobalSessionManager remains excluded")
    print("[pass] DefaultSessionGateway remains app-scoped")
    return 0


if __name__ == "__main__":
    sys.exit(main())


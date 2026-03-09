#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ANDROID_MAIN_SRC = REPO_ROOT / "android-app" / "app" / "src" / "main"
CODE_GLOBS = ("*.kt", "*.java")


@dataclass(frozen=True)
class DeferredGate:
    gate_id: str
    summary: str
    code_markers: tuple[str, ...]
    evidence_file: Path
    required_fields: tuple[str, ...]


DEFERRED_GATES = (
    DeferredGate(
        gate_id="K03",
        summary="StreamingMarkdown 保持条件延后",
        code_markers=("StreamingMarkdown",),
        evidence_file=REPO_ROOT / ".ai" / "analysis" / "k03-streaming-markdown-reentry.json",
        required_fields=(
            "decision",
            "reason",
            "composeMetricsFresh",
            "streamingJankObserved",
            "terminalPerfRetained",
            "verificationCommands",
        ),
    ),
    DeferredGate(
        gate_id="K04",
        summary="MessageRepository / LRU / 分页保持条件延后",
        code_markers=("MessageRepository", "LazyPagingItems", "paging3"),
        evidence_file=REPO_ROOT / ".ai" / "analysis" / "k04-message-repository-reentry.json",
        required_fields=(
            "decision",
            "reason",
            "oomObserved",
            "longTimelineRegressionObserved",
            "memoryOrTimelineEvidence",
            "chatListBehaviorRetained",
            "verificationCommands",
        ),
    ),
)


def iter_source_files() -> list[Path]:
    files: list[Path] = []
    for pattern in CODE_GLOBS:
        files.extend(ANDROID_MAIN_SRC.rglob(pattern))
    return sorted(files)


def find_marker_hits(marker: str) -> list[tuple[Path, int, str]]:
    hits: list[tuple[Path, int, str]] = []
    for path in iter_source_files():
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            if marker in line:
                hits.append((path, line_number, line.strip()))
    return hits


def load_evidence(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_gate(gate: DeferredGate) -> list[str]:
    hits: list[tuple[Path, int, str]] = []
    for marker in gate.code_markers:
        hits.extend(find_marker_hits(marker))

    if not hits:
        return [f"[pass] {gate.gate_id} 保持延后：未检测到 {', '.join(gate.code_markers)}"]

    if not gate.evidence_file.exists():
        relative_path = gate.evidence_file.relative_to(REPO_ROOT).as_posix()
        details = "\n".join(
            f"    {path.relative_to(REPO_ROOT).as_posix()}:{line_number}: {line}"
            for path, line_number, line in hits
        )
        raise SystemExit(
            f"[fail] {gate.gate_id} 检测到延后能力已进入主代码，但缺少准入证据文件：{relative_path}\n{details}"
        )

    evidence = load_evidence(gate.evidence_file)
    missing_fields = [field for field in gate.required_fields if field not in evidence]
    if missing_fields:
        raise SystemExit(
            f"[fail] {gate.gate_id} 准入证据缺少字段: {', '.join(missing_fields)}"
        )

    if evidence.get("decision") != "approved":
        raise SystemExit(f"[fail] {gate.gate_id} 准入证据 decision 必须为 approved")

    return [
        f"[pass] {gate.gate_id} 已提供重开证据：{gate.evidence_file.relative_to(REPO_ROOT).as_posix()}"
    ]


def main() -> int:
    messages: list[str] = []
    for gate in DEFERRED_GATES:
        messages.extend(validate_gate(gate))

    for message in messages:
        print(message)
    print("[pass] Deferred re-entry gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

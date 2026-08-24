# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML==6.0.3"]
# ///
"""Assert config-consistency read sets are covered by their pipeline triggers."""

from __future__ import annotations

import ast
import json
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import yaml

REPO_ROOT = Path(__file__).parents[2]
CHECK_PATHS = (
    "apps/agent/src/animichi/tests/unit/test_documentation_guardrails.py",
    "apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py",
    "workers/users/test/eddsa-shared-primitive.worker.test.ts",
    "apps/web/tests/unit/chat/turnstile-constants-guard.test.ts",
)
TS_READS = re.compile(
    r"export\s+const\s+READS\s*=\s*(\[[^]]*])\s+as\s+const\s*;", re.DOTALL
)
class MetaCheckError(ValueError):
    """Raised when static CI metadata cannot be interpreted safely."""


@dataclass(frozen=True)
class ConfigCheck:
    path: Path
    component: str
    reads: tuple[str, ...]


def string_sequence(value: object, source: str) -> tuple[str, ...]:
    is_sequence = isinstance(value, Sequence) and not isinstance(value, str)
    if not is_sequence or not all(isinstance(item, str) for item in value):
        raise MetaCheckError(f"{source}: expected a string sequence")
    return tuple(cast(Sequence[str], value))


def assigned_reads(node: ast.stmt) -> ast.expr | None:
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.value if node.target.id == "READS" else None
    if not isinstance(node, ast.Assign) or len(node.targets) != 1:
        return None
    target = node.targets[0]
    return node.value if isinstance(target, ast.Name) and target.id == "READS" else None


def eval_literal(text: str, source: str) -> object:
    # A READS assignment is only known to be *some* expression: `READS = helper()`
    # parses fine and then raises a bare ValueError here. MetaCheckError subclasses
    # ValueError, and catching a subclass does not catch its parent, so without
    # this the caller's handler is bypassed and the script dies on a traceback.
    try:
        return cast(object, ast.literal_eval(text))
    except (ValueError, SyntaxError) as error:
        raise MetaCheckError(
            f"{source}: READS must be a literal list of strings ({error})"
        ) from error


def literal_reads(value: object, source: str) -> tuple[str, ...]:
    reads = string_sequence(value, source)
    if not reads or len(reads) != len(set(reads)):
        raise MetaCheckError(f"{source}: READS must be non-empty and unique")
    return reads


def python_reads(path: Path, source: str) -> tuple[str, ...]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=source)
    values = tuple(value for node in tree.body if (value := assigned_reads(node)))
    if len(values) != 1:
        raise MetaCheckError(f"{source}: expected one module-level READS declaration")
    return literal_reads(eval_literal(values[0], source), source)


def typescript_reads(path: Path, source: str) -> tuple[str, ...]:
    matches = TS_READS.findall(path.read_text(encoding="utf-8"))
    if len(matches) != 1:
        raise MetaCheckError(
            f"{source}: expected one exported literal READS declaration"
        )
    return literal_reads(eval_literal(matches[0], source), source)


def component_for(path: Path) -> str:
    if len(path.parts) > 2 and path.parts[0] in {"apps", "workers"}:
        return path.parts[1]
    raise MetaCheckError(f"{path}: cannot infer a component CI lane")


def config_check(relative: str) -> ConfigCheck:
    path = Path(relative)
    extractor = python_reads if path.suffix == ".py" else typescript_reads
    return ConfigCheck(path, component_for(path), extractor(REPO_ROOT / path, relative))


def discover_checks() -> tuple[ConfigCheck, ...]:
    return tuple(config_check(path) for path in CHECK_PATHS)


def manifest() -> tuple[dict[str, object], ...]:
    path = REPO_ROOT / ".github/ci/components.json"
    document = cast(dict[str, object], json.loads(path.read_text()))
    return tuple(cast(list[dict[str, object]], document["components"]))


def owns(pattern: str, path: str) -> bool:
    root = pattern.removesuffix("/**").rstrip("/")
    read_root = path.removesuffix("/**").rstrip("/")
    return read_root == root or read_root.startswith(f"{root}/")


def selected_for_read(components: tuple[dict[str, object], ...], read: str) -> set[str]:
    selected = {str(item["name"]) for item in components if any(owns(pattern, read) for pattern in cast(list[str], item["paths"]))}
    if not selected:
        return {str(item["name"]) for item in components}
    changed = True
    while changed:
        before = len(selected)
        selected.update(str(item["name"]) for item in components if selected.intersection(cast(list[str], item["depends_on"])))
        changed = len(selected) != before
    return selected


def collect_failures(components: tuple[dict[str, object], ...]) -> tuple[str, ...]:
    return tuple(
        f"{check.path}: READS path '{read}' does not select {check.component}"
        for check in discover_checks()
        for read in check.reads
        if check.component not in selected_for_read(components, read)
    )


def run_check() -> int:
    failures = collect_failures(manifest())
    if failures:
        print("Config read-set trigger coverage failed:\n" + "\n".join(failures))
        return 1
    count = len(discover_checks())
    print(f"OK: {count} config check read sets are covered by affected closure")
    return 0


def main() -> int:
    try:
        return run_check()
    except (MetaCheckError, OSError, SyntaxError, yaml.YAMLError) as error:
        print(f"Config read-set meta-check error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

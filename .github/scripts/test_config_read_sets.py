# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML==6.0.3"]
# ///
"""Assert config-consistency read sets are covered by their pipeline triggers."""

from __future__ import annotations

import ast
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import yaml

REPO_ROOT = Path(__file__).parents[2]
WORKFLOWS_DIR = REPO_ROOT / ".github/workflows"
EVENT = "push"
CHECK_PATHS = (
    "apps/agent/src/animichi/tests/unit/test_documentation_guardrails.py",
    "apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py",
    "workers/maintenance/test/config.worker.test.ts",
    "workers/users/test/eddsa-shared-primitive.worker.test.ts",
    "apps/web/tests/unit/chat/turnstile-constants-guard.test.ts",
)
TS_READS = re.compile(
    r"export\s+const\s+READS\s*=\s*(\[[^]]*])\s+as\s+const\s*;", re.DOTALL
)
# Every config-check component owns a pipeline workflow (CI-1 union method,
# S0-v2 B4). Its pull_request trigger is pathless (merge_group compatibility),
# so PR coverage is unconditional; the workflow's push paths must carry the
# read closure — that is what this script asserts.
COMPONENT_WORKFLOWS: dict[str, str] = {
    "agent": "pipeline-agent.yml",
    "maintenance": "pipeline-maintenance.yml",
    "users": "pipeline-users.yml",
    "web": "pipeline-web.yml",
}
YamlMap = Mapping[str, object]


class MetaCheckError(ValueError):
    """Raised when static CI metadata cannot be interpreted safely."""


@dataclass(frozen=True)
class ConfigCheck:
    path: Path
    component: str
    reads: tuple[str, ...]


@dataclass(frozen=True)
class PathFilter:
    event: str
    source: str
    patterns: tuple[str, ...]
    workflow_path: Path


def yaml_mapping(value: object, source: str) -> YamlMap:
    if not isinstance(value, Mapping) or not all(isinstance(key, str) for key in value):
        raise MetaCheckError(f"{source}: expected a YAML mapping")
    return cast(YamlMap, value)


def yaml_document(text: str, source: str) -> YamlMap:
    parsed = cast(object, yaml.load(text, Loader=yaml.BaseLoader))
    return yaml_mapping(parsed, source)


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


def workflow_documents() -> dict[Path, YamlMap]:
    paths = (*WORKFLOWS_DIR.glob("*.yml"), *WORKFLOWS_DIR.glob("*.yaml"))
    return {
        path: yaml_document(path.read_text(encoding="utf-8"), str(path))
        for path in sorted(paths)
    }


def check_workflow_path(check: ConfigCheck) -> Path:
    try:
        name = COMPONENT_WORKFLOWS[check.component]
    except KeyError as error:
        raise MetaCheckError(
            f"{check.path}: component '{check.component}' has no pipeline workflow "
            f"registered in COMPONENT_WORKFLOWS"
        ) from error
    return WORKFLOWS_DIR / name


def push_paths(workflow: YamlMap, source: str) -> tuple[str, ...] | None:
    triggers = yaml_mapping(workflow.get("on"), f"{source}: on")
    config = triggers.get(EVENT)
    if not isinstance(config, Mapping) or "paths" not in config:
        return None
    event_config = yaml_mapping(config, f"{source}: on.{EVENT}")
    return string_sequence(event_config.get("paths"), f"{source}: on.{EVENT}.paths")


def unreadable_gate(condition: str, check: ConfigCheck) -> MetaCheckError:
    return MetaCheckError(
        f"{check.path}: the {check.component} lane has a path gate this check "
        "cannot read.\n"
        f"  expected the pull_request trigger to be pathless, got: {condition}\n"
        "Refusing rather than assuming coverage: an unreadable gate is "
        "exactly how a guard ends up never running. If the rewrite is "
        "intentional, teach this function the new form."
    )


def validate_pathless_pr(workflow: YamlMap, source: str, check: ConfigCheck) -> None:
    triggers = yaml_mapping(workflow.get("on"), f"{source}: on")
    config = triggers.get("pull_request")
    if isinstance(config, Mapping) and "paths" in config:
        raise unreadable_gate(str(config), check)


def github_glob_matches(pattern: str, path: str) -> bool:
    escaped = re.escape(pattern).replace(r"\*\*", "\0")
    single_segment = escaped.replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
    return re.fullmatch(single_segment.replace("\0", ".*"), path) is not None


def pattern_covers(pattern: str, read: str) -> bool:
    if not read.endswith("/**"):
        return github_glob_matches(pattern, read)
    if pattern in {"**", read}:
        return True
    if not pattern.endswith("/**"):
        return False
    return read[:-3] == pattern[:-3] or read[:-3].startswith(f"{pattern[:-3]}/")


def read_is_covered(read: str, patterns: tuple[str, ...]) -> bool:
    positives = tuple(pattern for pattern in patterns if not pattern.startswith("!"))
    negatives = tuple(pattern[1:] for pattern in patterns if pattern.startswith("!"))
    included = any(pattern_covers(pattern, read) for pattern in positives)
    excluded = any(pattern_covers(pattern, read) for pattern in negatives)
    return included and not excluded


def filter_failures(check: ConfigCheck, path_filter: PathFilter) -> tuple[str, ...]:
    lane = f"{check.component} lane"
    missing = tuple(
        read for read in check.reads if not read_is_covered(read, path_filter.patterns)
    )
    return tuple(
        f"{check.path}: READS path '{read}' is not covered by {path_filter.event} "
        f"paths for {path_filter.workflow_path.relative_to(REPO_ROOT)}:{lane} "
        f"({path_filter.source}: {list(path_filter.patterns)})"
        for read in missing
    )


def validate_lane_triggers(
    workflow: YamlMap, source: str, check: ConfigCheck
) -> tuple[str, ...]:
    validate_pathless_pr(workflow, source, check)
    patterns = push_paths(workflow, source)
    if patterns is None:
        raise MetaCheckError(
            f"{source}: the {check.component} lane must declare push paths "
            "carrying its read closure"
        )
    return patterns


def lane_failures(
    check: ConfigCheck, workflow_docs: dict[Path, YamlMap]
) -> tuple[str, ...]:
    path = check_workflow_path(check)
    patterns = validate_lane_triggers(workflow_docs[path], str(path), check)
    return filter_failures(
        check, PathFilter(EVENT, f"on.{EVENT}.paths", patterns, path)
    )


def collect_failures(workflow_docs: dict[Path, YamlMap]) -> tuple[str, ...]:
    failures: list[str] = []
    for check in discover_checks():
        failures.extend(lane_failures(check, workflow_docs))
    return tuple(failures)


def run_check() -> int:
    workflow_docs = workflow_documents()
    failures = collect_failures(workflow_docs)
    if failures:
        print("Config read-set trigger coverage failed:\n" + "\n".join(failures))
        return 1
    count = len(discover_checks())
    print(f"OK: {count} config check read sets are covered for push")
    return 0


def main() -> int:
    try:
        return run_check()
    except (MetaCheckError, OSError, SyntaxError, yaml.YAMLError) as error:
        print(f"Config read-set meta-check error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

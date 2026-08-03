# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML==6.0.3"]
# ///
"""Assert config-consistency read sets are covered by their CI trigger sets."""

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
CI_WORKFLOW = WORKFLOWS_DIR / "ci.yml"
EVENTS = ("push", "pull_request")
CHECK_PATHS = (
    "apps/agent/agent/tests/unit/test_documentation_guardrails.py",
    "apps/agent/agent/tests/unit/test_secrets_docs_consistency.py",
    "workers/maintenance/test/config.worker.test.ts",
)
TS_READS = re.compile(
    r"export\s+const\s+READS\s*=\s*(\[[^]]*])\s+as\s+const\s*;", re.DOTALL
)
YamlMap = Mapping[str, object]


class MetaCheckError(ValueError):
    """Raised when static CI metadata cannot be interpreted safely."""


@dataclass(frozen=True)
class ConfigCheck:
    path: Path
    component: str
    reads: tuple[str, ...]

    @property
    def job(self) -> str:
        return f"ci-{self.component}"


@dataclass(frozen=True)
class PathFilter:
    event: str
    source: str
    patterns: tuple[str, ...]


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


def job_mapping(workflow: YamlMap, job: str) -> YamlMap:
    jobs = yaml_mapping(workflow.get("jobs"), f"{CI_WORKFLOW}: jobs")
    return yaml_mapping(jobs.get(job), f"{CI_WORKFLOW}: job {job}")


def trigger_paths(workflow: YamlMap, event: str) -> tuple[str, ...] | None:
    triggers = yaml_mapping(workflow.get("on"), f"{CI_WORKFLOW}: on")
    config = triggers.get(event)
    if not isinstance(config, Mapping) or "paths" not in config:
        return None
    event_config = yaml_mapping(config, f"{CI_WORKFLOW}: on.{event}")
    return string_sequence(
        event_config.get("paths"), f"{CI_WORKFLOW}: on.{event}.paths"
    )


def workflow_steps(workflow: YamlMap) -> Sequence[object]:
    changes = job_mapping(workflow, "changes")
    steps = changes.get("steps")
    if not isinstance(steps, Sequence) or isinstance(steps, str):
        raise MetaCheckError(f"{CI_WORKFLOW}: changes.steps must be a sequence")
    return cast(Sequence[object], steps)


def changes_filter_source(workflow: YamlMap) -> str:
    for index, value in enumerate(workflow_steps(workflow)):
        step = yaml_mapping(value, f"{CI_WORKFLOW}: changes.steps[{index}]")
        if str(step.get("uses", "")).startswith("dorny/paths-filter@"):
            with_block = yaml_mapping(step.get("with"), "dorny/paths-filter with")
            return str(with_block.get("filters", ""))
    raise MetaCheckError(f"{CI_WORKFLOW}: dorny/paths-filter step missing")


def changes_filters(workflow: YamlMap) -> YamlMap:
    source = changes_filter_source(workflow)
    return yaml_document(source, f"{CI_WORKFLOW}: dorny filters")


def unreadable_gate(condition: str, check: ConfigCheck, marker: str) -> MetaCheckError:
    return MetaCheckError(
        f"{CI_WORKFLOW}: {check.job} has a path gate this check cannot read.\n"
        f"  expected the `if:` to contain both {marker!r} and "
        f"\"github.event_name != 'pull_request'\"\n"
        f"  actual: {condition}\n"
        "Refusing rather than assuming coverage: an unreadable gate is "
        "exactly how a guard ends up never running. If the rewrite is "
        "intentional, teach this function the new form."
    )


def validate_lane_condition(condition: str, check: ConfigCheck) -> None:
    marker = f"needs.changes.outputs.{check.component} == 'true'"
    pr_guard = "github.event_name != 'pull_request'"
    if marker not in condition or pr_guard not in condition:
        raise unreadable_gate(condition, check, marker)


def lane_paths(
    workflow: YamlMap, filters: YamlMap, check: ConfigCheck
) -> tuple[str, ...] | None:
    condition = str(job_mapping(workflow, check.job).get("if", ""))
    if not condition:
        return None
    validate_lane_condition(condition, check)
    return string_sequence(
        filters.get(check.component), f"dorny filter {check.component}"
    )


def direct_filter(workflow: YamlMap, event: str) -> PathFilter | None:
    paths = trigger_paths(workflow, event)
    if paths is None:
        return None
    return PathFilter(event, f"on.{event}.paths", paths)


def lane_filter(
    workflow: YamlMap, lanes: YamlMap, check: ConfigCheck
) -> PathFilter | None:
    paths = lane_paths(workflow, lanes, check)
    if paths is None:
        return None
    return PathFilter("pull_request", f"dorny:{check.component}", paths)


def active_filters(
    workflow: YamlMap,
    lanes: YamlMap,
    check: ConfigCheck,
    event: str,
) -> tuple[PathFilter, ...]:
    direct = direct_filter(workflow, event)
    lane = lane_filter(workflow, lanes, check) if event == "pull_request" else None
    return tuple(path_filter for path_filter in (direct, lane) if path_filter)


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
    missing = tuple(
        read for read in check.reads if not read_is_covered(read, path_filter.patterns)
    )
    return tuple(
        f"{check.path}: READS path '{read}' is not covered by {path_filter.event} "
        f"paths for {CI_WORKFLOW.relative_to(REPO_ROOT)}:{check.job} "
        f"({path_filter.source}: {list(path_filter.patterns)})"
        for read in missing
    )


def collect_failures(workflow: YamlMap, lanes: YamlMap) -> tuple[str, ...]:
    return tuple(
        failure
        for check in discover_checks()
        for event in EVENTS
        for path_filter in active_filters(workflow, lanes, check, event)
        for failure in filter_failures(check, path_filter)
    )


def run_check() -> int:
    workflow = workflow_documents()[CI_WORKFLOW]
    failures = collect_failures(workflow, changes_filters(workflow))
    if failures:
        print("Config read-set trigger coverage failed:\n" + "\n".join(failures))
        return 1
    count = len(discover_checks())
    print(f"OK: {count} config check read sets are covered for push and pull_request")
    return 0


def main() -> int:
    try:
        return run_check()
    except (MetaCheckError, OSError, SyntaxError, yaml.YAMLError) as error:
        print(f"Config read-set meta-check error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

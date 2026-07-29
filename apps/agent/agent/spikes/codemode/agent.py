"""Spike-only control and taught-CodeMode agent composition."""

from __future__ import annotations

from typing import Literal

from pydantic_ai import Agent, Tool
from pydantic_ai.agent import AgentInstructions
from pydantic_ai.capabilities import AgentCapability
from pydantic_ai_harness import CodeMode

from agent.agents.animichi_agent import (
    _INSTRUCTIONS,
    RuntimeOutput,
    _AnimichiManagedPrompt,
    _current_turn_language,
    _managed_prompt_capability,
    _modern_capabilities,
    _output_types,
    _record_missing_managed_prompt_token,
    build_animichi_agent,
    validate_output,
)
from agent.agents.animichi_tools import TOOLS as ANIMICHI_TOOLS
from agent.agents.base import resolve_model
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.web_tools import TOOLS as WEB_TOOLS

Arm = Literal["control", "codemode-taught"]
RAW_TOOLS = [*ANIMICHI_TOOLS, *WEB_TOOLS]
RAW_TOOL_NAMES = tuple(
    tool.name if isinstance(tool, Tool) else tool.__name__ for tool in RAW_TOOLS
)

CODEMODE_TEACHING_ADDENDUM = """\
## MiMo CodeMode lesson
For a multi-step retrieval or route request, make ONE `run_code` call containing
the whole script. Compose the available async functions in that script with
variables, branching, and error handling. Do not make one `run_code` call per
tool, and do not merely describe the script.

Worked example — resolve, search, and route in one script:
```python
resolved = await resolve_anime(title="君の名は。")
if resolved["outcome"] != "resolved":
    result = {"stage": "resolve", "outcome": resolved}
else:
    search = await search_bangumi(bangumi_id=resolved["bangumi_id"])
    if search["outcome"] != "ok":
        result = {"stage": "search", "outcome": search}
    else:
        try:
            route = await plan_route(
                search_result_ref=search["result_ref"], pacing="normal"
            )
            result = {"stage": "route", "outcome": route}
        except Exception as exc:
            result = {"stage": "route", "error": str(exc)}
result
```
Use the final expression as the script result; `print()` is unnecessary.

Monty is a restricted Python sandbox: class definitions are forbidden;
third-party imports are forbidden; the only importable stdlib modules are `sys`, `typing`, `asyncio`, `math`, `json`, `re`, `datetime`, `os`, and `pathlib`.
Filesystem, environment, and timing access are unavailable in this rematch.
"""


def _taught_instructions(
    managed: _AnimichiManagedPrompt | None,
) -> AgentInstructions[RuntimeDeps]:
    if managed is not None:
        return CODEMODE_TEACHING_ADDENDUM
    return [_INSTRUCTIONS, CODEMODE_TEACHING_ADDENDUM, _current_turn_language]


def _taught_capabilities(
    managed: _AnimichiManagedPrompt | None,
) -> list[AgentCapability[RuntimeDeps]]:
    capabilities = _modern_capabilities(managed, memory=None)
    capabilities.append(CodeMode(tools=RAW_TOOL_NAMES, dynamic_catalog=False))
    return capabilities


def build_taught_codemode_agent() -> Agent[RuntimeDeps, RuntimeOutput]:
    """Build the treatment arm from the current production fixtures."""
    managed = _managed_prompt_capability()
    _record_missing_managed_prompt_token()
    agent: Agent[RuntimeDeps, RuntimeOutput] = Agent(
        resolve_model(None),
        name="animichi-codemode-taught-rematch",
        deps_type=RuntimeDeps,
        output_type=_output_types(),
        instructions=_taught_instructions(managed),
        tools=RAW_TOOLS,
        retries=2,
        capabilities=_taught_capabilities(managed),
    )
    agent.output_validator(validate_output)
    return agent


def build_rematch_arm(arm: Arm) -> Agent[RuntimeDeps, RuntimeOutput]:
    """Build one isolated arm; production globals remain untouched."""
    if arm == "control":
        return build_animichi_agent()
    return build_taught_codemode_agent()

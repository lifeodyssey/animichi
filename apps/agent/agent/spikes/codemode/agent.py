"""Isolated CodeMode variant of the Animichi runtime agent."""

from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.capabilities import AgentCapability
from pydantic_ai_harness import CodeMode

from agent.agents.animichi_agent import (
    _INSTRUCTIONS,
    RuntimeOutput,
    _history_capabilities,
    _modern_hooks,
    _output_types,
    validate_output,
)
from agent.agents.animichi_tools import TOOLS as ANIMICHI_TOOLS
from agent.agents.base import resolve_model
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.web_tools import TOOLS as WEB_TOOLS

CODEMODE_TOOL_NAMES = tuple(tool.__name__ for tool in [*ANIMICHI_TOOLS, *WEB_TOOLS])


def build_codemode_animichi_agent() -> Agent[RuntimeDeps, RuntimeOutput]:
    """Build the spike-only agent without touching the production singleton."""
    capabilities: list[AgentCapability[RuntimeDeps]] = [*_history_capabilities()]
    capabilities.extend([_modern_hooks(), CodeMode(tools=CODEMODE_TOOL_NAMES)])
    agent: Agent[RuntimeDeps, RuntimeOutput] = Agent(
        resolve_model(None),
        name="animichi-codemode-spike",
        deps_type=RuntimeDeps,
        output_type=_output_types(),
        instructions=_INSTRUCTIONS,
        tools=[*ANIMICHI_TOOLS, *WEB_TOOLS],
        retries=2,
        capabilities=capabilities,
    )
    agent.output_validator(validate_output)
    return agent

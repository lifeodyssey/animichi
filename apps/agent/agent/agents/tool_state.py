"""Explicit named type for the agent's shared per-run tool call state.

Replaces the implicit convention of threading a bare ``dict[str, object]``
through tool and handler call chains, where nothing in the signature
distinguished "the shared tool state" from any other dict. ``ToolState`` is
nominally distinct so every function that reads/writes it documents that
intent — while remaining exactly ``dict[str, object]`` at runtime (a
``NewType`` has zero runtime cost and changes no behavior).

Splitting ``ToolState``'s *stored values* into a fully typed session-state +
per-tool-results shape is a separate, larger effort — see the docstring on
``RuntimeDeps.tool_state``.
"""

from __future__ import annotations

from typing import NewType

ToolState = NewType("ToolState", dict[str, object])


def new_tool_state() -> ToolState:
    """Build an empty ``ToolState`` for a fresh agent run."""
    return ToolState({})

"""SD-17 length governance: fail when the static prompt section exceeds budget.

Counts tokens in the literal ``_INSTRUCTIONS`` string in ``animichi_agent.py``
(the static, cache-friendly prompt segment — dynamic per-turn injections like
the current-turn language and JST date/time are appended separately and are
not part of this budget). Parsed via ``ast`` rather than imported, so this
stays a lightweight, secret-free CI check with no ``Settings()``/env-var
dependency. Uses ``tiktoken``, a hard transitive dependency of this project's
own ``pydantic-ai`` (via ``pydantic-ai-slim[openai]``), so no extra
dependency is declared for it.

Usage: uv run python scripts/check_prompt_token_budget.py
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import tiktoken

TOKEN_BUDGET = 2000
_INSTRUCTIONS_NAME = "_INSTRUCTIONS"
_ENCODING_NAME = "cl100k_base"
_INSTRUCTIONS_PATH = (
    Path(__file__).resolve().parent.parent / "agent" / "agents" / "animichi_agent.py"
)


def count_tokens(text: str) -> int:
    """Count tokens with the same encoding family the runtime models use."""
    encoding = tiktoken.get_encoding(_ENCODING_NAME)
    return len(encoding.encode(text))


def extract_static_instructions(source: str) -> str:
    """Return the literal ``_INSTRUCTIONS`` value exactly as Python evaluates it."""
    assignment = _find_instructions_assignment(ast.parse(source))
    value: object = ast.literal_eval(assignment.value)
    if not isinstance(value, str):
        raise TypeError(f"{_INSTRUCTIONS_NAME} must be a string literal")
    return value


def _find_instructions_assignment(tree: ast.Module) -> ast.Assign:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and _assigns_instructions(node):
            return node
    raise ValueError(f"No `{_INSTRUCTIONS_NAME} = ...` assignment found")


def _assigns_instructions(node: ast.Assign) -> bool:
    return any(
        isinstance(target, ast.Name) and target.id == _INSTRUCTIONS_NAME
        for target in node.targets
    )


def check_budget(token_count: int, budget: int = TOKEN_BUDGET) -> bool:
    """Return whether the static prompt fits within the SD-17 token budget."""
    return token_count <= budget


def main() -> int:
    source = _INSTRUCTIONS_PATH.read_text(encoding="utf-8")
    instructions = extract_static_instructions(source)
    token_count = count_tokens(instructions)
    if check_budget(token_count):
        print(f"prompt_token_budget: {token_count}/{TOKEN_BUDGET} tokens (OK)")
        return 0
    print(
        f"prompt_token_budget: {token_count}/{TOKEN_BUDGET} tokens EXCEEDS budget",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())

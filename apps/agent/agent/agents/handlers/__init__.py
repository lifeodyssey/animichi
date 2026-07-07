"""Handler modules for ExecutorAgent tool dispatch."""

from __future__ import annotations

from agent.agents.handlers.answer_question import execute as execute_answer_question
from agent.agents.handlers.greet_user import execute as execute_greet_user
from agent.agents.handlers.result import HandlerResult

__all__ = [
    "HandlerResult",
    "execute_answer_question",
    "execute_greet_user",
]

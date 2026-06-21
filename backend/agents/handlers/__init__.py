"""Handler modules for ExecutorAgent tool dispatch."""

from __future__ import annotations

from backend.agents.handlers.answer_question import execute as execute_answer_question
from backend.agents.handlers.greet_user import execute as execute_greet_user
from backend.agents.handlers.plan_selected import execute as execute_plan_selected
from backend.agents.handlers.result import HandlerResult

__all__ = [
    "HandlerResult",
    "execute_answer_question",
    "execute_greet_user",
    "execute_plan_selected",
]

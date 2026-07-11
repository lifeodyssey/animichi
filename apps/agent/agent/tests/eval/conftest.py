"""Eval-specific fixtures — imports testcontainer DB from conftest_db.

Eval tests need real API keys (not mock settings) to call LLM providers.
The setup_test_environment fixture from the parent conftest is overridden
here to load real settings from .env instead of mock settings.

The ``real_db`` fixture is defined in ``conftest_db`` (shared with integration tests).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import dotenv_values

from agent.tests.eval.eval_common import real_env_updates

pytest_plugins = ("agent.tests.conftest_db",)

# Load real .env so eval tests have real API keys, but let a real value already in
# the process environment win over a stale .env. The parent tests/conftest.py
# seeds fake "test-key" creds via os.environ.setdefault; only those (and unset
# vars) are filled from .env, so CI secrets, rotated keys, and DEFAULT_AGENT_MODEL
# set in the environment are never silently overwritten.
_ENV_PATH = Path(__file__).parents[3] / ".env"
os.environ.update(real_env_updates(dotenv_values(_ENV_PATH), os.environ))


@pytest.fixture(autouse=True)
def setup_test_environment() -> Iterator[None]:
    """Override parent conftest's mock settings — eval needs real API keys."""
    yield

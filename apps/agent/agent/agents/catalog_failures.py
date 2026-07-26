"""Failures that catalog-backed model tools degrade into typed outcomes."""

from __future__ import annotations

from agent.clients.errors import APIError

CATALOG_FAILURES = (APIError, OSError, RuntimeError)

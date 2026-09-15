"""The contract's shared error envelope.

Every error response any endpoint answers must be ``{error: {code, message}}``
with both members strings: the frontend branches on the code, and a shape
drifting here is what makes one endpoint's failure look different from
another's. One case per rejection family — a missing identity (400) — drives the
envelope through the client in ``_api_contract_client.py``.
"""

from __future__ import annotations

import pytest

from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.integration._api_contract_client import contract_client


class TestErrorShape:
    """All error responses must follow {error: {code, message}} shape."""

    _ERROR_CASES = [
        ("GET", "/v1/conversations", None, None, 400),
    ]

    @pytest.mark.parametrize(
        ("method", "path", "json_body", "headers", "expected_status"),
        _ERROR_CASES,
        ids=[f"{m} {p}" for m, p, *_ in _ERROR_CASES],
    )
    async def test_error_responses_have_standard_shape(
        self,
        tc_db: PersistenceRepos,
        method: str,
        path: str,
        json_body: dict[str, object] | None,
        headers: dict[str, str] | None,
        expected_status: int,
    ) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.request(
                method, path, json=json_body, headers=headers or {}
            )
        assert resp.status_code == expected_status
        body = resp.json()
        assert "error" in body
        error = body["error"]
        assert "code" in error
        assert "message" in error
        assert isinstance(error["code"], str)
        assert isinstance(error["message"], str)

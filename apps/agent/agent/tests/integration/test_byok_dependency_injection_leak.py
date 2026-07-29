"""P1-1 regression: the BYOK credential never enters `fastapi.arguments.values`.

`logfire.instrument_fastapi()` captures every `Depends()`-resolved endpoint
parameter verbatim into the `fastapi.arguments.values` span attribute. An
earlier revision put `byok: ByokCredential | None` in `handle_chat`'s own
signature — the plaintext key was kept out of spans only because the
dependency happened to be named `byok`, which the Task 2 scrub pattern
(`r"byok"`) matches by coincidence, not by any structural guarantee. Renaming
the parameter (or refactoring the credential to a differently-named field)
would have silently reopened the leak.

The fix (`_get_byok_credential`/`_resolve_byok_model` called directly from
inside `handle_chat`'s body, never as a route parameter) makes this
impossible by construction: `byok` is never a key in `solve_dependencies`'
`values` dict at all, so there is nothing for any scrub pattern to have to
save. This test proves that structurally, with real `logfire.instrument_fastapi()`
active — not the homegrown scrubber, which is Task 2's own concern.
"""

from __future__ import annotations

import pytest
from logfire.testing import TestExporter

from agent.tests.integration import _byok_redaction_shared as shared
from agent.tests.unit.conftest_fastapi import async_client, build_app

pytestmark = pytest.mark.integration


@pytest.fixture
def logfire_sinks(monkeypatch: pytest.MonkeyPatch) -> TestExporter:
    return shared.build_logfire_sinks(monkeypatch, scrubbing_enabled=False)


def _fastapi_arguments_values(exporter: TestExporter) -> str:
    """Extract only the `fastapi.arguments.values` span attribute, so the
    assertion is tied to the actual vulnerability rather than to a
    file-wide text search that could pass or fail for unrelated reasons."""
    chunks: list[str] = []
    for span in exporter.exported_spans:
        if not span.attributes:
            continue
        value = span.attributes.get("fastapi.arguments.values")
        if value is not None:
            chunks.append(str(value))
    return "\n".join(chunks)


async def test_byok_credential_never_enters_fastapi_arguments_values(
    logfire_sinks: TestExporter,
) -> None:
    """With Logfire's own scrubbing disabled (isolating this from Task 2's
    scrub-pattern safety net entirely): the credential must still not be
    capturable, because it is never a `Depends()`-resolved value in the
    first place."""
    app, _ = build_app(runtime_api=shared.success_runtime())

    async with async_client(app) as client:
        await client.post(
            "/v1/chat",
            json=shared.chat_body(),
            headers={
                "X-User-Id": "user-1",
                **shared.BYOK_HEADER_FAMILIES["openai-compatible"],
            },
        )

    arguments_text = _fastapi_arguments_values(logfire_sinks)
    assert shared.FAKE_KEY not in arguments_text
    assert "byok" not in arguments_text.lower()

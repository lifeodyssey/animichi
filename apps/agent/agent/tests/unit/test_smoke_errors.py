"""Classification and redaction of errored L0 smoke cases (#434).

The gate used to print a bare count. These tests pin the replacement: every
errored case is named with its exception type and a redacted message, provider
transport failures are separated from agent failures, and only the latter
block the merge.
"""

from __future__ import annotations

from agent.tests.eval.smoke_errors import (
    MESSAGE_LIMIT,
    SmokeErrorSummary,
    classify_error,
    format_transport_notice,
    redact_secrets,
    smoke_error_failures,
    summarize_errors,
)


def _summary(*messages: tuple[str, str], total: int = 80) -> SmokeErrorSummary:
    errors = [classify_error(case_id, message) for case_id, message in messages]
    return summarize_errors(errors, total)


def test_transport_exception_type_is_classified_as_transport() -> None:
    error = classify_error("A2_zh_003", "ReadError: connection reset by peer")

    assert error.error_class == "transport"
    assert error.error_type == "ReadError"


def test_read_timeout_is_classified_as_transport() -> None:
    error = classify_error("A5_en_001", "ReadTimeout: timed out")

    assert error.error_class == "transport"


def test_retryable_http_status_is_classified_as_transport() -> None:
    error = classify_error(
        "A1_ja_002", "UnexpectedModelBehavior: status_code: 429, rate limited"
    )

    assert error.error_class == "transport"


def test_agent_exception_type_is_classified_as_agent() -> None:
    error = classify_error("A3_ja_004", "ValidationError: intent is not a valid enum")

    assert error.error_class == "agent"
    assert error.error_type == "ValidationError"


def test_message_without_type_prefix_falls_back_to_unknown_agent_error() -> None:
    error = classify_error("A4_en_002", "something went sideways")

    assert error.error_type == "UnknownError"
    assert error.error_class == "agent"


def test_missing_error_message_is_still_reported() -> None:
    error = classify_error("A4_en_003", None)

    assert error.error_type == "UnknownError"
    assert error.case_id == "A4_en_003"


def test_api_key_in_error_message_is_redacted() -> None:
    error = classify_error(
        "A1_ja_001", "APIConnectionError: auth failed for sk-abc123def456ghi"
    )

    assert "sk-abc123def456ghi" not in error.message
    assert "[REDACTED]" in error.message


def test_bearer_token_is_redacted() -> None:
    assert "shhhh" not in redact_secrets("Authorization: Bearer shhhh")


def test_long_error_message_is_truncated() -> None:
    error = classify_error("A1_ja_001", "ValueError: " + "x" * 500)

    assert len(error.message) == MESSAGE_LIMIT + 1


def test_agent_errors_block_the_gate_and_name_every_case() -> None:
    summary = _summary(
        ("A3_ja_004", "ValidationError: bad output"),
        ("A6_en_007", "KeyError: 'results'"),
    )

    failures = smoke_error_failures(summary)

    assert len(failures) == 1
    assert "A3_ja_004" in failures[0] and "A6_en_007" in failures[0]
    assert "ValidationError: bad output" in failures[0]


def test_isolated_transport_errors_do_not_block_the_gate() -> None:
    summary = _summary(
        ("A2_zh_003", "ReadError: reset"), ("A5_en_001", "ReadTimeout: slow")
    )

    assert smoke_error_failures(summary) == []


def test_transport_errors_are_still_reported_when_not_blocking() -> None:
    notice = format_transport_notice(_summary(("A2_zh_003", "ReadError: reset")))

    assert "A2_zh_003" in notice
    assert "1/80" in notice


def test_no_transport_errors_produces_no_notice() -> None:
    assert format_transport_notice(_summary(("A3_ja_004", "KeyError: x"))) == ""


def test_transport_errors_above_the_ceiling_fail_the_run_as_untrustworthy() -> None:
    messages = [(f"case_{index}", "ReadError: reset") for index in range(3)]
    summary = _summary(*messages, total=10)

    failures = smoke_error_failures(summary)

    assert len(failures) == 1
    assert "untrustworthy" in failures[0]


def test_clean_run_produces_no_failures() -> None:
    assert smoke_error_failures(summarize_errors([], 80)) == []


# pydantic-ai raises ModelHTTPError for ANY 4xx or 5xx. Classifying the type as
# transport would excuse the exact regressions this gate exists to catch: a
# prompt-size or tool-schema break surfaces as a provider 400, and a handful of
# those sit under the 20% transport ceiling and merge green.
def test_a_provider_4xx_is_an_agent_error_not_transport() -> None:
    error = classify_error(
        "A1_ja_014",
        "ModelHTTPError: status_code: 400, model_name: mimo-v2.5, "
        "body: {'error': 'context length exceeded'}",
    )

    assert error.error_class == "agent"


def test_an_unprocessable_entity_is_an_agent_error() -> None:
    error = classify_error(
        "A4_en_002", "ModelHTTPError: status_code: 422, model_name: mimo-v2.5, body: {}"
    )

    assert error.error_class == "agent"


def test_a_provider_5xx_is_still_transport() -> None:
    error = classify_error(
        "A6_zh_007", "ModelHTTPError: status_code: 503, model_name: mimo-v2.5, body: {}"
    )

    assert error.error_class == "transport"


def test_a_bare_number_in_prose_does_not_excuse_an_agent_error() -> None:
    """ "429" as a token count must not be read as a rate-limit status."""
    error = classify_error(
        "A7_en_009",
        "UnexpectedModelBehavior: Exceeded maximum retries (1) for output "
        "validation after 429 tokens",
    )

    assert error.error_class == "agent"


# Both fixtures are assembled at runtime rather than written as literals: a
# JWT-shaped or key-shaped string sitting in the source is exactly what this
# repo's own gitleaks scan exists to reject, and it cannot tell a test fixture
# from a real credential (it failed this PR once for precisely that). Assembling
# keeps the shape the regex must match without putting a scannable token in the
# tree.
def test_a_jwt_in_an_error_body_is_redacted() -> None:
    jwt = f"{'ey' + 'J' + 'a' * 12}.{'b' * 10}.{'c' * 10}"

    error = classify_error("A8_ja_001", f"APIConnectionError: rejected {jwt}")

    assert jwt not in error.message


def test_an_underscore_style_key_is_redacted() -> None:
    key = "sk" + "_live_" + "a" * 16

    error = classify_error("A9_en_003", f"APIConnectionError: bad key {key}")

    assert key not in error.message

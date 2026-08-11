"""GetSessionHistory telemetry tests (SESSION-1 #959).

Outcome, message count, and revision are recorded — never an actor identifier
or any message content.
"""

from __future__ import annotations

from logfire.testing import CaptureLogfire

from animichi.infrastructure.observability import record_history_request
from animichi.tests.unit._observability_testing import (
    first_data_point,
    metric_by_name,
)


class TestHistoryMetrics:
    def test_record_history_request_emits_counter_and_histogram(
        self, capfire: CaptureLogfire
    ) -> None:
        record_history_request(
            duration_ms=2.0, outcome="ok", message_count=3, revision=5
        )

        names = set(metric_by_name(capfire))
        assert {"history_requests_total", "history_request_duration_ms"} <= names

    def test_record_history_request_tags_attributes_without_actor_or_content(
        self, capfire: CaptureLogfire
    ) -> None:
        record_history_request(
            duration_ms=2.0, outcome="not_found", message_count=0, revision=0
        )

        counter = metric_by_name(capfire)["history_requests_total"]
        point = first_data_point(counter)
        assert point.attributes == {
            "outcome": "not_found",
            "message_count": 0,
            "revision": 0,
        }

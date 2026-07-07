"""Unit tests for the logfire-backed observability wrapper."""

from logfire.testing import CaptureLogfire

from agent.infrastructure.observability import (
    http_span,
    record_http_request,
    record_runtime_request,
    runtime_span,
)


def _metric_by_name(capfire: CaptureLogfire) -> dict[str, dict[str, object]]:
    return {m["name"]: m for m in capfire.get_collected_metrics()}


def _first_data_point(metric: dict[str, object]) -> dict[str, object]:
    data = metric["data"]
    if not isinstance(data, dict):
        raise TypeError(f"Expected dict metric data, got {type(data)}")
    points = data["data_points"]
    if not isinstance(points, list) or not points:
        raise ValueError("Metric has no data points")
    point = points[0]
    if not isinstance(point, dict):
        raise TypeError(f"Expected dict data point, got {type(point)}")
    return point


class TestSpans:
    def test_runtime_span_exports_named_span(self, capfire: CaptureLogfire) -> None:
        with runtime_span("runtime.handle"):
            pass

        names = [s.name for s in capfire.exporter.exported_spans]
        assert "runtime.handle" in names

    def test_runtime_span_records_attributes(self, capfire: CaptureLogfire) -> None:
        with runtime_span("runtime.handle") as span:
            span.set_attribute("runtime.intent", "search_bangumi")

        exported = capfire.exporter.exported_spans_as_dict()
        assert exported[-1]["attributes"]["runtime.intent"] == "search_bangumi"

    def test_runtime_span_records_exception_event(
        self, capfire: CaptureLogfire
    ) -> None:
        with runtime_span("runtime.handle") as span:
            span.record_exception(ValueError("boom"))

        events = capfire.exporter.exported_spans_as_dict()[-1].get("events", [])
        exception_types = [e["attributes"]["exception.type"] for e in events]
        assert "ValueError" in exception_types

    def test_http_span_exports_named_span(self, capfire: CaptureLogfire) -> None:
        with http_span("http.request") as span:
            span.set_attribute("http.method", "GET")

        names = [s.name for s in capfire.exporter.exported_spans]
        assert "http.request" in names


class TestRuntimeMetrics:
    def test_record_runtime_request_emits_counter_and_histogram(
        self, capfire: CaptureLogfire
    ) -> None:
        record_runtime_request(
            duration_ms=12.5,
            intent="search_bangumi",
            status="ok",
            transport="public_api",
        )

        names = set(_metric_by_name(capfire))
        assert {"runtime_requests_total", "runtime_request_duration_ms"} <= names

    def test_record_runtime_request_tags_request_attributes(
        self, capfire: CaptureLogfire
    ) -> None:
        record_runtime_request(
            duration_ms=1.0,
            intent="plan_route",
            status="ok",
            transport="public_api",
        )

        counter = _metric_by_name(capfire)["runtime_requests_total"]
        point = _first_data_point(counter)
        assert point["attributes"] == {
            "intent": "plan_route",
            "status": "ok",
            "transport": "public_api",
        }

    def test_record_runtime_request_records_duration_value(
        self, capfire: CaptureLogfire
    ) -> None:
        record_runtime_request(
            duration_ms=250.0,
            intent="search_bangumi",
            status="ok",
            transport="public_api",
        )

        histogram = _metric_by_name(capfire)["runtime_request_duration_ms"]
        point = _first_data_point(histogram)
        assert point["sum"] == 250.0


class TestHttpMetrics:
    def test_record_http_request_emits_counter_and_histogram(
        self, capfire: CaptureLogfire
    ) -> None:
        record_http_request(
            duration_ms=3.0, method="GET", route="/healthz", status_code=200
        )

        names = set(_metric_by_name(capfire))
        assert {"http_requests_total", "http_request_duration_ms"} <= names

    def test_record_http_request_tags_request_attributes(
        self, capfire: CaptureLogfire
    ) -> None:
        record_http_request(
            duration_ms=3.0, method="GET", route="/healthz", status_code=200
        )

        counter = _metric_by_name(capfire)["http_requests_total"]
        point = _first_data_point(counter)
        assert point["attributes"] == {
            "http.method": "GET",
            "http.route": "/healthz",
            "http.status_code": 200,
        }

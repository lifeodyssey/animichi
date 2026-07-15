"""Unit tests for the logfire-backed observability wrapper."""

from __future__ import annotations

import json
from typing import cast

import logfire
import pytest
from logfire.testing import CaptureLogfire, TestExporter
from opentelemetry.sdk.metrics.export import InMemoryMetricReader, MetricsData

from agent.config.settings import Settings
from agent.infrastructure.observability import (
    http_span,
    record_http_request,
    record_runtime_request,
    runtime_span,
)
from agent.interfaces.routes._deps import setup_logfire
from agent.tests.unit._observability_testing import (
    first_data_point,
    metric_by_name,
    patch_configure_with_test_sinks,
)


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

        names = set(metric_by_name(capfire))
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

        counter = metric_by_name(capfire)["runtime_requests_total"]
        point = first_data_point(counter)
        assert point.attributes == {
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

        histogram = metric_by_name(capfire)["runtime_request_duration_ms"]
        point = first_data_point(histogram)
        assert point.sum == 250.0


class TestHttpMetrics:
    def test_record_http_request_emits_counter_and_histogram(
        self, capfire: CaptureLogfire
    ) -> None:
        record_http_request(
            duration_ms=3.0, method="GET", route="/healthz", status_code=200
        )

        names = set(metric_by_name(capfire))
        assert {"http_requests_total", "http_request_duration_ms"} <= names

    def test_record_http_request_tags_request_attributes(
        self, capfire: CaptureLogfire
    ) -> None:
        record_http_request(
            duration_ms=3.0, method="GET", route="/healthz", status_code=200
        )

        counter = metric_by_name(capfire)["http_requests_total"]
        point = first_data_point(counter)
        assert point.attributes == {
            "http.method": "GET",
            "http.route": "/healthz",
            "http.status_code": 200,
        }


class TestDeploymentEnvironment:
    def test_setup_logfire_tags_span_with_deployment_environment(
        self, monkeypatch: pytest.MonkeyPatch, mock_settings: Settings
    ) -> None:
        exporter = TestExporter()
        configure_call = patch_configure_with_test_sinks(
            monkeypatch, exporter, InMemoryMetricReader()
        )
        monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)

        settings = mock_settings.model_copy(update={"app_env": "staging"})
        setup_logfire(settings)
        with runtime_span("runtime.env_check"):
            pass

        spans = exporter.exported_spans_as_dict(include_resources=True)
        resource_attributes = spans[-1]["resource"]["attributes"]
        assert resource_attributes["deployment.environment.name"] == "staging"
        assert isinstance(configure_call.scrubbing, logfire.ScrubbingOptions)

    def test_setup_logfire_tags_metric_with_deployment_environment(
        self, monkeypatch: pytest.MonkeyPatch, mock_settings: Settings
    ) -> None:
        metrics_reader = InMemoryMetricReader()
        patch_configure_with_test_sinks(monkeypatch, TestExporter(), metrics_reader)
        monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)

        settings = mock_settings.model_copy(update={"app_env": "staging"})
        setup_logfire(settings)
        record_runtime_request(
            duration_ms=1.0,
            intent="search_bangumi",
            status="ok",
            transport="public_api",
        )

        raw_metrics_data = cast(MetricsData, metrics_reader.get_metrics_data())
        metrics_data = json.loads(raw_metrics_data.to_json())
        resource_attributes = metrics_data["resource_metrics"][0]["resource"][
            "attributes"
        ]
        assert resource_attributes["deployment.environment.name"] == "staging"

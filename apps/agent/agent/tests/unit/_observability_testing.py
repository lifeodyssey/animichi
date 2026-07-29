"""Shared typed test helpers for logfire-backed observability tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import logfire
import pytest
from logfire.testing import CaptureLogfire, TestExporter
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export import SimpleSpanProcessor


@dataclass(frozen=True)
class MetricDataPoint:
    """A single exported metric data point."""

    attributes: dict[str, str | int]
    sum: float | None


@dataclass(frozen=True)
class CollectedMetric:
    """A metric collected via ``CaptureLogfire.get_collected_metrics``."""

    name: str
    data_points: tuple[MetricDataPoint, ...]


@dataclass
class ConfigureCall:
    """Arguments captured by the patched ``logfire.configure`` call."""

    scrubbing: logfire.ScrubbingOptions | None = None


def _parse_data_point(raw: object) -> MetricDataPoint:
    if not isinstance(raw, dict):
        raise TypeError(f"Expected dict data point, got {type(raw)}")
    attributes = raw.get("attributes", {})
    if not isinstance(attributes, dict):
        raise TypeError(f"Expected dict attributes, got {type(attributes)}")
    raw_sum = raw.get("sum")
    if raw_sum is not None and not isinstance(raw_sum, int | float):
        raise TypeError(f"Expected numeric sum, got {type(raw_sum)}")
    return MetricDataPoint(attributes=attributes, sum=raw_sum)


def _parse_metric(raw: object) -> CollectedMetric:
    if not isinstance(raw, dict):
        raise TypeError(f"Expected dict metric, got {type(raw)}")
    name = raw["name"]
    if not isinstance(name, str):
        raise TypeError(f"Expected str name, got {type(name)}")
    data = raw["data"]
    if not isinstance(data, dict):
        raise TypeError(f"Expected dict metric data, got {type(data)}")
    points = data["data_points"]
    if not isinstance(points, list) or not points:
        raise ValueError("Metric has no data points")
    return CollectedMetric(
        name=name, data_points=tuple(_parse_data_point(p) for p in points)
    )


def metric_by_name(capfire: CaptureLogfire) -> dict[str, CollectedMetric]:
    """Collect exported metrics from ``capfire``, keyed by metric name."""
    raw_metrics = capfire.get_collected_metrics()
    return {
        metric.name: metric for metric in (_parse_metric(raw) for raw in raw_metrics)
    }


def first_data_point(metric: CollectedMetric) -> MetricDataPoint:
    """Return the first data point recorded for ``metric``."""
    return metric.data_points[0]


def patch_configure_with_test_sinks(
    monkeypatch: pytest.MonkeyPatch,
    exporter: TestExporter,
    metrics_reader: InMemoryMetricReader,
) -> ConfigureCall:
    """Route ``logfire.configure`` calls to test span/metric sinks.

    Only forwards the keyword arguments ``setup_logfire`` actually passes;
    everything else is fixed so spans/metrics land in the test sinks.
    """
    real_configure = logfire.configure
    configure_call = ConfigureCall()

    def configure_with_test_sinks(
        *,
        service_name: str | None = None,
        service_version: str | None = None,
        environment: str | None = None,
        send_to_logfire: bool | Literal["if-token-present"] | None = None,
        console: bool | None = None,
        scrubbing: logfire.ScrubbingOptions | None = None,
        variables: object | None = None,
    ) -> logfire.Logfire:
        del send_to_logfire, console, variables
        configure_call.scrubbing = scrubbing
        return real_configure(
            service_name=service_name,
            service_version=service_version,
            environment=environment,
            send_to_logfire=False,
            console=False,
            additional_span_processors=[SimpleSpanProcessor(exporter)],
            metrics=logfire.MetricsOptions(additional_readers=[metrics_reader]),
        )

    monkeypatch.setattr(logfire, "configure", configure_with_test_sinks)
    return configure_call

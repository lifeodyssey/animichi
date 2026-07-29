"""Unit tests for the D4 vision-supply decision tree and D5 runtime canary."""

from __future__ import annotations

import httpx
import pytest

from agent.agents.vision_supply_router import (
    EndpointId,
    VisionCapabilityRegistry,
    VisionRecognition,
    VisionRecognitionFailed,
    VisionSupply,
    choose_vision_route,
    quota_guidance,
    quota_tier_for,
)

_ENDPOINT = EndpointId("byok-1")


class StubProvider:
    def __init__(self, recognition: VisionRecognition) -> None:
        self.recognition = recognition
        self.calls = 0

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        self.calls += 1
        return self.recognition


class FailingProvider:
    """A provider whose ``recognize`` always raises a transport failure."""

    def __init__(self, error: Exception) -> None:
        self._error = error
        self.calls = 0

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        self.calls += 1
        raise self._error


def _transport_error() -> httpx.ConnectError:
    return httpx.ConnectError("connection refused")


def _rec(count: int, titles: list[str]) -> VisionRecognition:
    return VisionRecognition(reported_image_count=count, candidate_titles=titles)


def test_no_byok_routes_platform_on_anon_tier() -> None:
    route = choose_vision_route(None, VisionCapabilityRegistry(), authenticated=False)
    assert route.provider_kind == "platform"
    assert route.quota_tier == "anon"


def test_unprobed_byok_routes_platform() -> None:
    route = choose_vision_route(
        _ENDPOINT, VisionCapabilityRegistry(), authenticated=True
    )
    assert route.provider_kind == "platform"
    assert route.quota_tier == "member"


def test_probed_capable_byok_routes_byok() -> None:
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    route = choose_vision_route(_ENDPOINT, registry, authenticated=True)
    assert route.provider_kind == "byok"


def test_quota_tiers_split_by_authentication() -> None:
    assert quota_tier_for(False) == "anon"
    assert quota_tier_for(True) == "member"


def test_guidance_branches_by_premise() -> None:
    assert quota_guidance(None) == "configure_vision_key"
    assert quota_guidance(_ENDPOINT) == "switch_vision_endpoint"


async def test_canary_mismatch_demotes_endpoint_and_falls_back() -> None:
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    byok = StubProvider(_rec(5, ["byok-title"]))
    platform = StubProvider(_rec(1, ["platform-title"]))
    supply = VisionSupply(
        platform=platform, registry=registry, byok=byok, byok_endpoint=_ENDPOINT
    )
    result = await supply.recognize([b"img"], "ja", authenticated=True)
    assert result.recognition.candidate_titles == ["platform-title"]
    assert result.provider_kind == "platform"
    assert result.fell_back_to_platform is True
    assert registry.is_vision_capable(_ENDPOINT) is False
    assert byok.calls == 1
    assert platform.calls == 1


async def test_correct_canary_count_keeps_byok_answer() -> None:
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    byok = StubProvider(_rec(1, ["byok-title"]))
    platform = StubProvider(_rec(1, ["platform-title"]))
    supply = VisionSupply(
        platform=platform, registry=registry, byok=byok, byok_endpoint=_ENDPOINT
    )
    result = await supply.recognize([b"img"], "ja", authenticated=True)
    assert result.recognition.candidate_titles == ["byok-title"]
    assert result.provider_kind == "byok"
    assert result.fell_back_to_platform is False
    assert platform.calls == 0


async def test_byok_transport_failure_falls_back_to_platform() -> None:
    """#502: a dead/misconfigured BYOK key must degrade to platform, not raise."""
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    byok = FailingProvider(_transport_error())
    platform = StubProvider(_rec(1, ["platform-title"]))
    supply = VisionSupply(
        platform=platform, registry=registry, byok=byok, byok_endpoint=_ENDPOINT
    )
    result = await supply.recognize([b"img"], "ja", authenticated=True)
    assert result.provider_kind == "platform"
    assert result.fell_back_to_platform is True
    assert registry.is_vision_capable(_ENDPOINT) is False
    assert byok.calls == 1
    assert platform.calls == 1


async def test_platform_failure_raises_typed_recognition_failed() -> None:
    """#502: the router must not let the raw provider exception escape."""
    platform = FailingProvider(_transport_error())
    supply = VisionSupply(platform=platform, registry=VisionCapabilityRegistry())
    with pytest.raises(VisionRecognitionFailed):
        await supply.recognize([b"img"], "ja", authenticated=False)
    assert platform.calls == 1


async def test_platform_failure_after_byok_fallback_still_raises() -> None:
    """Both providers exhausted: the caller gets one typed failure, not a 500."""
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    byok = FailingProvider(_transport_error())
    platform = FailingProvider(_transport_error())
    supply = VisionSupply(
        platform=platform, registry=registry, byok=byok, byok_endpoint=_ENDPOINT
    )
    with pytest.raises(VisionRecognitionFailed):
        await supply.recognize([b"img"], "ja", authenticated=True)
    assert byok.calls == 1
    assert platform.calls == 1


async def test_platform_route_never_touches_byok_provider() -> None:
    byok = StubProvider(_rec(1, ["byok-title"]))
    platform = StubProvider(_rec(1, ["platform-title"]))
    supply = VisionSupply(
        platform=platform,
        registry=VisionCapabilityRegistry(),
        byok=byok,
        byok_endpoint=_ENDPOINT,
    )
    result = await supply.recognize([b"img"], "ja", authenticated=False)
    assert result.recognition.candidate_titles == ["platform-title"]
    assert result.fell_back_to_platform is False
    assert byok.calls == 0

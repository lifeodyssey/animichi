"""Unit tests for the D4 vision-supply decision tree and D5 runtime canary."""

from __future__ import annotations

import httpx
import pytest

from agent.agents.vision_supply_router import (
    EndpointId,
    VisionCapabilityRegistry,
    VisionProviderMisconfigured,
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


def _auth_error() -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://vision.example/recognize")
    response = httpx.Response(401, request=request)
    return httpx.HTTPStatusError("unauthorized", request=request, response=response)


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


async def test_byok_transient_failure_falls_back_without_demoting() -> None:
    """#502 P2: a one-off network blip must fall back for this call only —
    it must NOT permanently sideline an otherwise-working BYOK endpoint."""
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
    assert registry.is_vision_capable(_ENDPOINT) is True
    assert byok.calls == 1
    assert platform.calls == 1


async def test_byok_auth_failure_falls_back_and_demotes() -> None:
    """#502 P2: an auth-shaped failure (401/403) means a bad key, not a
    hiccup — it demotes the endpoint the same way a canary mismatch does."""
    registry = VisionCapabilityRegistry()
    registry.mark(_ENDPOINT, True)
    byok = FailingProvider(_auth_error())
    platform = StubProvider(_rec(1, ["platform-title"]))
    supply = VisionSupply(
        platform=platform, registry=registry, byok=byok, byok_endpoint=_ENDPOINT
    )
    result = await supply.recognize([b"img"], "ja", authenticated=True)
    assert result.provider_kind == "platform"
    assert registry.is_vision_capable(_ENDPOINT) is False


async def test_platform_misconfigured_raises_typed_recognition_failed() -> None:
    """#502 P1-1: a provider with no credential at all must still surface as
    a typed failure through the router, not an uncaught exception."""
    platform = FailingProvider(VisionProviderMisconfigured("no key"))
    supply = VisionSupply(platform=platform, registry=VisionCapabilityRegistry())
    with pytest.raises(VisionRecognitionFailed):
        await supply.recognize([b"img"], "ja", authenticated=False)


async def test_provider_bug_is_not_swallowed_as_a_fallback() -> None:
    """#502 P2: a genuine bug in provider code (not a network/auth failure)
    must still surface as an uncaught exception — the catch tuple must stay
    narrow, or a real bug gets silently reinterpreted as a designed
    fallback. ValueError specifically: pydantic.ValidationError subclasses
    it, so it must not be in the caught tuple."""
    platform = FailingProvider(ValueError("provider validation bug"))
    supply = VisionSupply(platform=platform, registry=VisionCapabilityRegistry())
    with pytest.raises(ValueError, match="provider validation bug"):
        await supply.recognize([b"img"], "ja", authenticated=False)


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

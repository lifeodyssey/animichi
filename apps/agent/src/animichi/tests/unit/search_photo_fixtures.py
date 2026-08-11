"""Shared fixtures for the SearchPhoto / ConfirmPhotoOffer seam tests.

The application seam is exercised with the real in-process adapters wherever
possible: the infra ``PhotoSearchQuota`` and ``InMemoryPhotoOfferStore`` run
on a fixed clock, and the production pipeline (``agents.photo_search.
run_photo_search``) runs against ``FakeCatalog`` with a stubbed vision call.
"""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Literal

from animichi.agents.photo_search import run_photo_search
from animichi.application.confirm_photo_offer import ConfirmPhotoOffer
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.application.photo_offers import PhotoOfferStore
from animichi.application.search_photo import (
    GpsPoint,
    ModelPrices,
    PhotoIdentity,
    PhotoVisionResult,
    SearchPhoto,
    SearchPhotoCommand,
    SearchPhotoPolicy,
)
from animichi.domain.ports import UsageMeter
from animichi.infrastructure.observability.photo_search import PhotoSearchQuota
from animichi.infrastructure.photo_offers import InMemoryPhotoOfferStore
from animichi.tests.unit.photo_search_fakes import FakeCatalog

# Valid JPEG magic so the strict sniff accepts the stub payload.
IMAGE = b"\xff\xd8\xff\xe0route-image"
_FIXED_NOW = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)


class FixedClock:
    """A mutable clock so tests can advance time deterministically."""

    def __init__(self, now: datetime = _FIXED_NOW) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


class FakeByok:
    """A `ByokSession` double recording every close call."""

    def __init__(self) -> None:
        self.closed = 0

    async def close(self) -> None:
        self.closed += 1


def vision_stub(
    titles: list[str], provider_kind: Literal["byok", "platform"] = "platform"
) -> Callable[[list[bytes], str], Awaitable[PhotoVisionResult]]:
    async def call(images: list[bytes], locale: str) -> PhotoVisionResult:
        del images, locale
        return PhotoVisionResult(titles, provider_kind, ModelTurnUsage(requests=1))

    return call


def make_search(
    *,
    offers: PhotoOfferStore | None = None,
    quota: PhotoSearchQuota | None = None,
    policy: SearchPhotoPolicy | None = None,
    usage_repo: UsageMeter | None = None,
    byok: FakeByok | None = None,
    clock: FixedClock | None = None,
    vision: Callable[[list[bytes], str], Awaitable[PhotoVisionResult]] | None = None,
    pipeline: Callable | None = None,
) -> tuple[SearchPhoto, FixedClock]:
    """A SearchPhoto over real infra adapters; returns the use case + clock."""
    fixed = clock if clock is not None else FixedClock()
    offer_store = offers if offers is not None else InMemoryPhotoOfferStore(clock=fixed)
    quota_counter = quota if quota is not None else PhotoSearchQuota(clock=fixed)
    search = SearchPhoto(
        vision=vision if vision is not None else vision_stub(["君の名は。"]),
        pipeline=pipeline if pipeline is not None else _pipeline(FakeCatalog()),
        offers=offer_store,
        quota=quota_counter,
        policy=policy
        or SearchPhotoPolicy(
            quota_anon=None, quota_member=None, prices=ModelPrices(2.0, 2.0)
        ),
        usage_repo=usage_repo,
        byok=byok,
        clock=fixed,
    )
    return search, fixed


def make_confirm(
    offers: PhotoOfferStore, clock: Callable[[], datetime] | None = None
) -> ConfirmPhotoOffer:
    return ConfirmPhotoOffer(offers=offers, clock=clock or FixedClock())


def _pipeline(catalog: FakeCatalog) -> Callable:
    async def run(recognize, gps):
        return await run_photo_search(recognize, catalog, gps)

    return run


def command(
    *,
    user_id: str | None = None,
    user_type: str | None = None,
    image: bytes = IMAGE,
    image_base64: str | None = None,
    mime: str = "image/jpeg",
    gps: GpsPoint | None = None,
    quota_key: str = "key-1",
    has_byok: bool = False,
    locale: str = "ja",
) -> SearchPhotoCommand:
    return SearchPhotoCommand(
        image_base64=(
            image_base64
            if image_base64 is not None
            else base64.b64encode(image).decode("ascii")
        ),
        mime_type=mime,
        gps=gps,
        locale=locale,
        identity=PhotoIdentity(user_id=user_id, user_type=user_type),
        quota_key=quota_key,
        has_byok=has_byok,
    )

"""SearchPhoto usage attribution and BYOK cleanup (AGENT-1 #952).

The seam owns the usage policy: the payer scope follows the model that
actually answered (byok → byok scope, platform → identity scope), BYOK spend
is always zero-cost, and the per-request BYOK session is closed on every exit
path — success, quota rejection, image rejection, and pipeline failure alike.
"""

from __future__ import annotations

import pytest

from animichi.application.search_photo import (
    ModelPrices,
    PhotoSearchRejection,
    SearchPhotoPolicy,
)
from animichi.tests.unit.photo_search_route_fixtures import UsageRepo
from animichi.tests.unit.search_photo_fixtures import (
    FakeByok,
    command,
    make_search,
    vision_stub,
)


def _policy() -> SearchPhotoPolicy:
    return SearchPhotoPolicy(
        quota_anon=None, quota_member=None, prices=ModelPrices(2.0, 2.0)
    )


async def test_platform_vision_is_recorded_in_the_anonymous_scope() -> None:
    repo = UsageRepo()
    search, _ = make_search(usage_repo=repo, policy=_policy())
    await search(command())
    assert [(call.scope, call.requests) for call in repo.calls] == [("anon", 1)]


async def test_member_platform_vision_is_recorded_in_the_user_scope() -> None:
    repo = UsageRepo()
    search, _ = make_search(usage_repo=repo, policy=_policy())
    await search(command(user_id="user-1", user_type="human"))
    assert [call.scope for call in repo.calls] == ["user"]


async def test_byok_vision_is_recorded_as_byok_scope_with_zero_platform_cost() -> None:
    repo = UsageRepo()
    search, _ = make_search(
        usage_repo=repo,
        policy=_policy(),
        vision=vision_stub(["君の名は。"], provider_kind="byok"),
    )
    await search(command(user_id="user-1", user_type="human"))
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("byok", 0.0)]


async def test_no_usage_repo_never_records() -> None:
    search, _ = make_search(usage_repo=None, policy=_policy())
    result = await search(command())
    assert result.offer_id != ""


async def test_byok_session_is_closed_after_a_successful_turn() -> None:
    byok = FakeByok()
    search, _ = make_search(byok=byok, policy=_policy())
    await search(command())
    assert byok.closed == 1


async def test_byok_session_is_closed_when_quota_rejects() -> None:
    byok = FakeByok()
    search, _ = make_search(
        byok=byok,
        policy=SearchPhotoPolicy(
            quota_anon=0, quota_member=None, prices=ModelPrices(2.0, 2.0)
        ),
    )
    with pytest.raises(PhotoSearchRejection):
        await search(command())
    assert byok.closed == 1


async def test_byok_session_is_closed_when_the_image_is_invalid() -> None:
    byok = FakeByok()
    search, _ = make_search(byok=byok, policy=_policy())
    with pytest.raises(PhotoSearchRejection):
        await search(command(image=b"not-an-image"))
    assert byok.closed == 1


async def test_byok_session_is_closed_when_the_pipeline_fails() -> None:
    byok = FakeByok()

    async def boom(recognize, gps):
        del recognize, gps
        raise RuntimeError("pipeline exploded")

    search, _ = make_search(byok=byok, policy=_policy(), pipeline=boom)
    with pytest.raises(RuntimeError, match="pipeline exploded"):
        await search(command())
    assert byok.closed == 1

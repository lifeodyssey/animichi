"""Unit tests for `animichi.agents.photo_vision` (#656).

Reanchors the behavior that mattered from the two files this replaces:
- `test_gemini_vision.py`'s magic-byte mime sniffing (`sniff_image_mime`
  moved here — it is still used to validate every uploaded photo, and now
  also to label the `BinaryContent` part sent to the model).
- `test_vision_supply_router.py`'s BYOK-fails-falls-back-to-platform and
  platform-exhausted-raises-typed-failure behavior, replayed against real
  `pydantic_ai.Agent` runs via `FunctionModel` instead of a hand-rolled
  `VisionProvider` protocol stub. The D5 "reported image count" canary and
  its per-endpoint demotion registry are NOT reanchored: that mechanism
  existed only to catch an endpoint silently dropping image parts, which
  required its own capability-eval harness — deferred to S1 (#656 PR body).
"""

from __future__ import annotations

import httpx
import pytest
from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from animichi.agents.photo_vision import (
    VisionRecognitionFailed,
    recognize_photo,
    sniff_image_mime,
)

_YOURNAME_JPEG = b"\xff\xd8\xff\xe0" + b"fake-jpeg-bytes"


def test_sniff_mime_covers_the_supported_formats() -> None:
    assert sniff_image_mime(b"\x89PNG\r\n\x1a\n" + b"data") == "image/png"
    assert sniff_image_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert sniff_image_mime(b"\xff\xd8\xff\xe0data") == "image/jpeg"


def test_sniff_image_mime_rejects_non_image_bytes() -> None:
    assert sniff_image_mime(b"not an image") is None
    assert sniff_image_mime(b"RIFF\x00\x00\x00\x00WAVE") is None
    assert sniff_image_mime(b"\x89PNG\r\n") is None  # truncated signature


def _titles_response(titles: list[str]) -> object:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[ToolCallPart(tool_name=tool.name, args={"candidate_titles": titles})]
        )

    return fn


def _counting(titles: list[str]) -> tuple[FunctionModel, list[int]]:
    calls: list[int] = []

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        calls.append(1)
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[ToolCallPart(tool_name=tool.name, args={"candidate_titles": titles})]
        )

    return FunctionModel(fn), calls


def _raising(exc: Exception) -> object:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise exc

    return fn


def _sent_images(messages: list[ModelMessage]) -> list[bytes]:
    request = messages[-1]
    images: list[bytes] = []
    for part in request.parts:
        if isinstance(part, UserPromptPart) and isinstance(part.content, list):
            images.extend(
                item.data for item in part.content if isinstance(item, BinaryContent)
            )
    return images


async def test_platform_recognition_sends_binary_content_and_parses_titles() -> None:
    """The core replacement behavior (#656): a real image goes to the model
    as `BinaryContent`, correctly mime-labelled, and the structured output
    comes back as candidate titles — no hand-rolled REST payload."""
    seen: list[bytes] = []

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.extend(_sent_images(messages))
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name=tool.name, args={"candidate_titles": ["君の名は。"]}
                )
            ]
        )

    platform = FunctionModel(fn)
    result = await recognize_photo(platform, None, [_YOURNAME_JPEG], "ja")
    assert result.candidate_titles == ["君の名は。"]
    assert result.provider_kind == "platform"
    assert seen == [_YOURNAME_JPEG]


async def test_byok_answer_is_used_and_platform_is_never_called() -> None:
    byok, byok_calls = _counting(["byok-title"])
    platform, platform_calls = _counting(["platform-title"])
    result = await recognize_photo(platform, byok, [b"img"], "ja")
    assert result.candidate_titles == ["byok-title"]
    assert result.provider_kind == "byok"
    assert byok_calls == [1]
    assert platform_calls == []


async def test_byok_failure_falls_back_to_platform() -> None:
    """#502 origin, replayed against the new recognition path: a failing
    BYOK model must not sideline the whole turn — it falls back to platform
    for this call."""
    byok = FunctionModel(_raising(httpx.ConnectError("connection refused")))
    platform, platform_calls = _counting(["platform-title"])
    result = await recognize_photo(platform, byok, [b"img"], "ja")
    assert result.candidate_titles == ["platform-title"]
    assert result.provider_kind == "platform"
    assert platform_calls == [1]


async def test_no_byok_model_never_touches_byok() -> None:
    """When the request carried no BYOK credential, `recognize_photo` gets
    `byok_model=None` and must go straight to platform."""
    platform, platform_calls = _counting(["platform-title"])
    result = await recognize_photo(platform, None, [b"img"], "ja")
    assert result.provider_kind == "platform"
    assert platform_calls == [1]


async def test_platform_failure_raises_typed_recognition_failed() -> None:
    """#502: the caller must not see the raw provider exception."""
    platform = FunctionModel(_raising(httpx.ConnectError("connection refused")))
    with pytest.raises(VisionRecognitionFailed):
        await recognize_photo(platform, None, [b"img"], "ja")


async def test_both_providers_exhausted_still_raises_one_typed_failure() -> None:
    byok = FunctionModel(_raising(httpx.ConnectError("connection refused")))
    platform = FunctionModel(_raising(httpx.ConnectError("connection refused")))
    with pytest.raises(VisionRecognitionFailed):
        await recognize_photo(platform, byok, [b"img"], "ja")


async def test_provider_bug_is_not_swallowed_as_a_fallback() -> None:
    """#502: a genuine bug (not a network/transport failure) must still
    surface as an uncaught exception — the catch tuple stays narrow, or a
    real bug gets silently reinterpreted as a designed fallback."""
    platform = FunctionModel(_raising(ValueError("provider validation bug")))
    with pytest.raises(ValueError, match="provider validation bug"):
        await recognize_photo(platform, None, [b"img"], "ja")

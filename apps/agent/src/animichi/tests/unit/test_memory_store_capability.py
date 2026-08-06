"""Official harness Memory behavior over its process-local store."""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai_harness.memory import (
    InMemoryStore,
    Memory,
    MemoryConflictError,
)


def _has_return(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _tool_result(messages: list[ModelMessage], tool_name: str) -> object:
    return next(
        part.content
        for message in messages
        for part in getattr(message, "parts", [])
        if isinstance(part, ToolReturnPart) and part.tool_name == tool_name
    )


async def test_memory_tools_write_read_search_and_delete() -> None:
    store = InMemoryStore()

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not _has_return(messages, "write_memory"):
            args = {"file": "profile", "content": "Prefers quiet temples."}
            return ModelResponse(
                parts=[ToolCallPart("write_memory", args, tool_call_id="write")]
            )
        if not _has_return(messages, "read_memory"):
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "read_memory", {"file": "profile"}, tool_call_id="read"
                    )
                ]
            )
        if not _has_return(messages, "search_memory"):
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "search_memory", {"query": "quiet"}, tool_call_id="search"
                    )
                ]
            )
        if not _has_return(messages, "delete_memory"):
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "delete_memory", {"file": "profile"}, tool_call_id="delete"
                    )
                ]
            )
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(respond), capabilities=[Memory(store, namespace="u1")])
    result = await agent.run("curate memory")
    messages = result.all_messages()

    assert _tool_result(messages, "read_memory") == "Prefers quiet temples.\n"
    search = _tool_result(messages, "search_memory")
    assert isinstance(search, dict)
    matches = search["matches"]
    assert isinstance(matches, list)
    first_match = matches[0]
    assert isinstance(first_match, dict)
    assert first_match["file"] == "profile.md"
    assert _tool_result(messages, "delete_memory")["status"] == "deleted"
    assert await store.read("u1/main/profile.md", max_chars=100) is None


async def test_in_memory_store_surfaces_stale_version_conflicts() -> None:
    store = InMemoryStore()
    await store.write("u1/main/MEMORY.md", "first", expected_version=None)

    with pytest.raises(MemoryConflictError, match="changed before"):
        await store.write(
            "u1/main/MEMORY.md", "stale overwrite", expected_version="stale"
        )


async def test_namespaces_cannot_search_each_others_files() -> None:
    store = InMemoryStore(
        {
            "user-a/main/MEMORY.md": "Likes quiet temples.",
            "user-b/main/MEMORY.md": "Likes busy arcades.",
        }
    )

    result_a = await store.search(
        "user-a/main/",
        "likes",
        limit=10,
        max_files=10,
        max_chars=1_000,
        max_file_chars=1_000,
    )
    result_b = await store.search(
        "user-b/main/",
        "likes",
        limit=10,
        max_files=10,
        max_chars=1_000,
        max_file_chars=1_000,
    )

    assert [match.path for match in result_a.matches] == ["user-a/main/MEMORY.md"]
    assert [match.path for match in result_b.matches] == ["user-b/main/MEMORY.md"]

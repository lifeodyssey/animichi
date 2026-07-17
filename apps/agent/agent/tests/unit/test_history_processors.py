"""Unit tests for the native compaction summary callback."""

from agent.agents.tool_outcomes import ResolveAmbiguous, ResolveResolved, SearchOk


class TestSummarizeToolContent:
    def test_search_bangumi_summary(self) -> None:
        from agent.agents.animichi_agent import _summarize_tool_content

        result = _summarize_tool_content(
            "search_bangumi",
            SearchOk(
                result_ref="search:haruhi",
                row_count=76,
                anime_title="涼宮ハルヒの憂鬱",
            ).model_dump(),
        )
        assert result == "[search_bangumi: found 76 spots for 涼宮ハルヒの憂鬱]"

    def test_resolve_anime_summary(self) -> None:
        from agent.agents.animichi_agent import _summarize_tool_content

        result = _summarize_tool_content(
            "resolve_anime",
            ResolveResolved(
                bangumi_id="485",
                anime_title="涼宮ハルヒの憂鬱",
            ).model_dump(),
        )
        assert result == "[resolve_anime: resolved to 涼宮ハルヒの憂鬱 (id=485)]"

    def test_resolve_anime_ambiguous(self) -> None:
        from agent.agents.animichi_agent import _summarize_tool_content

        result = _summarize_tool_content(
            "resolve_anime",
            ResolveAmbiguous(candidate_ids=["485", "1177"]).model_dump(),
        )
        assert result == "[resolve_anime: ambiguous, 2 candidates]"

    def test_unknown_tool_fallback(self) -> None:
        from agent.agents.animichi_agent import _summarize_tool_content

        result = _summarize_tool_content("unknown_tool", "some content")
        assert "completed" in result

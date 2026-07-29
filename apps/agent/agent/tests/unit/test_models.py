from agent.agents.models import ToolName


class TestToolName:
    def test_values(self):
        assert ToolName.RESOLVE_ANIME == "resolve_anime"
        assert ToolName.SEARCH_BANGUMI == "search_bangumi"
        assert ToolName.SEARCH_NEARBY == "search_nearby"
        assert ToolName.PLAN_ROUTE == "plan_route"
        assert ToolName.GEOCODE == "geocode"

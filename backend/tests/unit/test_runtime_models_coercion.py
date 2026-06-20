"""Reasoning models (e.g. MiMo) sometimes serialize a nested object field as a
JSON string instead of a nested object. The response models must coerce such a
string back into the nested model so typed-output validation does not fail.
"""

import json

from backend.agents.runtime_models import (
    ClarifyDataModel,
    ClarifyResponseModel,
    SearchDataModel,
    SearchResponseModel,
)


def test_search_response_coerces_stringified_data() -> None:
    raw = {
        "intent": "search_bangumi",
        "message": "ok",
        "data": json.dumps({"results": {"rows": [], "row_count": 0}}),
    }

    model = SearchResponseModel.model_validate(raw)

    assert isinstance(model.data, SearchDataModel)


def test_clarify_response_coerces_stringified_data() -> None:
    raw = {
        "intent": "clarify",
        "message": "?",
        "data": json.dumps({"status": "needs_clarification", "question": "which one?"}),
    }

    model = ClarifyResponseModel.model_validate(raw)

    assert isinstance(model.data, ClarifyDataModel)


def test_search_response_still_accepts_nested_object_data() -> None:
    raw = {
        "intent": "search_bangumi",
        "message": "ok",
        "data": {"results": {"rows": [], "row_count": 0}},
    }

    model = SearchResponseModel.model_validate(raw)

    assert isinstance(model.data, SearchDataModel)

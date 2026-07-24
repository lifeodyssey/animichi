"""Unit tests for response-model field descriptions (SD-17d) and ErrorResponseModel (SD-18)."""

from __future__ import annotations

from agent.agents.runtime_models import (
    AgentResultOutput,
    ClarifyResponseModel,
    ErrorResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)

_FIVE_RESPONSE_MODELS = (
    SearchResponseModel,
    RouteResponseModel,
    GreetingResponseModel,
    ClarifyResponseModel,
    QAResponseModel,
)


def test_every_field_on_the_five_response_models_has_a_description() -> None:
    for model in _FIVE_RESPONSE_MODELS:
        schema = model.model_json_schema()
        for name, field_schema in schema["properties"].items():
            assert field_schema.get("description"), (
                f"{model.__name__}.{name} is missing a Field(description=...)"
            )


def test_message_descriptions_are_specific_per_response_type() -> None:
    descriptions = {
        model.__name__: model.model_json_schema()["properties"]["message"][
            "description"
        ]
        for model in _FIVE_RESPONSE_MODELS
    }
    assert len(set(descriptions.values())) == len(descriptions)


def test_qa_message_description_forbids_truncation() -> None:
    schema = QAResponseModel.model_json_schema()
    assert "never" in schema["properties"]["message"]["description"].lower()


def test_clarify_candidate_ids_description_states_ordering_contract() -> None:
    schema = ClarifyResponseModel.model_json_schema()
    description = schema["properties"]["candidate_ids"]["description"].lower()
    assert "order" in description


def test_error_response_model_is_runner_only_never_a_model_output() -> None:
    assert ErrorResponseModel not in (
        SearchResponseModel,
        RouteResponseModel,
        GreetingResponseModel,
        ClarifyResponseModel,
        QAResponseModel,
    )
    assert ErrorResponseModel in AgentResultOutput.__args__


def test_error_response_model_marks_the_uniform_error_discriminator() -> None:
    payload = ErrorResponseModel(message="something failed")
    assert payload.error is True
    assert payload.model_dump() == {"message": "something failed", "error": True}

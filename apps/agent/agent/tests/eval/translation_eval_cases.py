"""Translation eval case definitions and deterministic evaluators."""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from agent.agents.translation import TranslationKind
from agent.clients.catalog_client import CatalogClientProtocol


@dataclass
class TranslationInput:
    title: str
    target_locale: str
    kind: TranslationKind


@dataclass
class TranslationOutput:
    translated: str
    source: str
    confidence: float


@dataclass
class TranslationExpected:
    expected: str


_Ctx = EvaluatorContext[TranslationInput, TranslationOutput, TranslationExpected]
TaskFn = Callable[[TranslationInput], Coroutine[object, object, TranslationOutput]]


def make_translation_task(catalog: CatalogClientProtocol) -> TaskFn:
    """Create a translation eval task with the catalog bound via closure."""

    async def task(inp: TranslationInput) -> TranslationOutput:
        from agent.agents.translation import translate_title

        result = await translate_title(
            inp.title,
            target_locale=inp.target_locale,
            kind=inp.kind,
            catalog=catalog,
        )
        return TranslationOutput(
            translated=result.translated,
            source=result.source,
            confidence=result.confidence,
        )

    return task


def _expected_text(ctx: _Ctx) -> str | None:
    return ctx.metadata.expected.strip() if ctx.metadata else None


class ExactMatchEvaluator(
    Evaluator[TranslationInput, TranslationOutput, TranslationExpected]
):
    """Score 1.0 if translation exactly matches expected."""

    def evaluate(self, ctx: _Ctx) -> float:
        expected = _expected_text(ctx)
        if expected is None:
            return 0.0
        return 1.0 if ctx.output.translated.strip() == expected else 0.0


class FuzzyMatchEvaluator(
    Evaluator[TranslationInput, TranslationOutput, TranslationExpected]
):
    """Score 1.0 if translation contains or is contained by expected."""

    def evaluate(self, ctx: _Ctx) -> float:
        expected = _expected_text(ctx)
        if expected is None:
            return 0.0
        actual = ctx.output.translated.strip().lower()
        target = expected.lower()
        if actual == target:
            return 1.0
        if target in actual or actual in target:
            return 0.8
        return 0.0


class NotOriginalEvaluator(
    Evaluator[TranslationInput, TranslationOutput, TranslationExpected]
):
    """Score 1.0 if translation is different from the original input."""

    def evaluate(self, ctx: _Ctx) -> float:
        expected = _expected_text(ctx)
        if expected is None:
            return 0.0
        original = ctx.inputs.title.strip()
        translated = ctx.output.translated.strip()
        if expected == original:
            return 1.0
        return 1.0 if translated != original else 0.0


_DATASET_PATH = Path(__file__).parent / "datasets" / "translation_v1.json"


class _RawMetadata(TypedDict):
    category: TranslationKind


class _RawCase(TypedDict):
    id: str
    title: str
    target: str
    expected: str
    metadata: _RawMetadata


def _case(
    item: _RawCase,
) -> Case[TranslationInput, TranslationOutput, TranslationExpected]:
    return Case(
        name=item["id"],
        inputs=TranslationInput(
            item["title"], item["target"], item["metadata"]["category"]
        ),
        metadata=TranslationExpected(expected=item["expected"]),
    )


def _load_cases() -> list[
    Case[TranslationInput, TranslationOutput, TranslationExpected]
]:
    raw = cast(list[_RawCase], json.loads(_DATASET_PATH.read_text()))
    return [_case(item) for item in raw]


CASES = _load_cases()

translation_dataset = Dataset(
    name="translation_v1",
    cases=CASES,
    evaluators=[
        ExactMatchEvaluator(),
        FuzzyMatchEvaluator(),
        NotOriginalEvaluator(),
    ],
)

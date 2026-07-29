"""Unit tests for `RetainedEntityLedger`'s bounded, deduplicating,
oldest-wins record path and its restore-time bound enforcement.

`CompactToolReturns`-level integration (the call-site that populates this
ledger during compaction) lives in `test_history_compaction_verbatim.py`.
"""

from __future__ import annotations

from agent.domain.compaction_retention import (
    MAX_RETAINED_BYTES,
    MAX_RETAINED_ENTITIES,
    RetainedEntity,
    RetainedEntityLedger,
)


def test_fresh_ledger_is_empty() -> None:
    assert RetainedEntityLedger().is_empty()


def test_blank_value_after_sanitization_is_a_no_op() -> None:
    ledger = RetainedEntityLedger()

    ledger.record("search_nearby", "   \x00\x1f  ")

    assert ledger.is_empty()


def test_recording_the_same_entity_twice_does_not_duplicate() -> None:
    ledger = RetainedEntityLedger()

    ledger.record("search_nearby", "資生堂前")
    ledger.record("search_nearby", "資生堂前")

    assert len(ledger.entities) == 1


def test_recording_an_existing_entity_moves_it_to_the_tail() -> None:
    ledger = RetainedEntityLedger()
    for i in range(3):
        ledger.record("search_nearby", f"place-{i}")

    ledger.record("search_nearby", "place-0")

    assert [e.value for e in ledger.entities] == ["place-1", "place-2", "place-0"]


def test_repeated_record_of_the_same_entity_eight_times_is_idempotent() -> None:
    """Pins the production replay scenario: the same tool call recompacted
    on every subsequent turn (`session_facade.build_message_history` replays
    every past interaction's raw messages unchanged) must not grow the
    ledger."""
    ledger = RetainedEntityLedger()

    for _ in range(8):
        ledger.record("search_nearby", "資生堂前")

    assert len(ledger.entities) == 1


def test_distinct_entities_past_the_cap_are_oldest_wins_not_fifo() -> None:
    """The earliest, deep-history entities are the scarce resource this
    ledger exists to protect: a near-tail entity dropped here is still
    covered verbatim by the raw sliding window for a while yet, but a
    turn-0 entity evicted here is lost for good. A 9th distinct entity is
    therefore dropped, not swapped in over the 1st."""
    ledger = RetainedEntityLedger()

    for i in range(MAX_RETAINED_ENTITIES + 1):
        ledger.record("search_nearby", f"place-{i}")

    assert len(ledger.entities) == MAX_RETAINED_ENTITIES
    assert ledger.entities[0].value == "place-0"
    assert all(e.value != f"place-{MAX_RETAINED_ENTITIES}" for e in ledger.entities)


def test_truncation_regression_never_exceeds_the_byte_cap() -> None:
    """Regression pin for the mutation that survived with truncation
    removed: an over-long tool_name and value are both truncated, and the
    encoded record never exceeds the per-field byte cap."""
    ledger = RetainedEntityLedger()
    long_value = "資" * 60  # 180 bytes, over the 96-byte per-field cap
    long_tool_name = "a-very-long-tool-name-" * 5

    ledger.record(long_tool_name, long_value)

    (entity,) = ledger.entities
    assert len(entity.value.encode("utf-8")) <= 96
    assert len(entity.tool_name.encode("utf-8")) <= 96
    assert entity.value.endswith("…")


def test_enforce_bounds_trims_a_directly_hydrated_oversized_ledger() -> None:
    """Restore-time backstop: a payload hydrated straight through
    `model_validate` — bypassing `record()` entirely, as a corrupted or
    future-deploy envelope would — still gets trimmed to the count cap,
    keeping the oldest entries."""
    oversized = RetainedEntityLedger(
        entities=[
            RetainedEntity(tool_name="search_nearby", value=f"place-{i}")
            for i in range(MAX_RETAINED_ENTITIES + 50)
        ]
    )

    oversized.enforce_bounds()

    assert len(oversized.entities) == MAX_RETAINED_ENTITIES
    assert oversized.entities[0].value == "place-0"


def test_enforce_bounds_trims_an_oversized_byte_payload() -> None:
    """A directly-hydrated ledger can carry values `record()` would have
    truncated (no per-field pydantic length constraint on `RetainedEntity`
    itself) — the byte backstop caps the whole ledger at `MAX_RETAINED_BYTES`
    even when the count cap alone would not have caught it."""
    oversized = RetainedEntityLedger(
        entities=[
            RetainedEntity(tool_name="search_nearby", value="資" * 2000)
            for _ in range(MAX_RETAINED_ENTITIES)
        ]
    )

    oversized.enforce_bounds()

    assert oversized.encoded_size_bytes() <= MAX_RETAINED_BYTES
    assert oversized.entities
    assert oversized.entities[0].tool_name == "search_nearby"

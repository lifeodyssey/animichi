"""Vulture whitelist: framework / protocol signature params that look unused.

Each name below is a genuine framework or typing-contract hook, not dead code.
Vulture flags them as "unused variable" because the bodies are stubs or the
params are dispatched positionally, but removing them would break the contract.

This file is a vulture DSL artifact (bare names), not importable source. It is
NOT in the `make lint` scope (`ruff check agent/`); it lives at the agent root.

Run:  uv run vulture agent/ vulture_whitelist.py
Regenerate (then re-annotate):  uv run vulture agent/ --make-whitelist
"""

# Uniform handler-dispatch signature: every handler is called as
# execute(step, context, db, retriever) by the registry, even when a given
# handler (greet_user, answer_question, clarify, plan_selected) needs no
# retrieval. The param is contractual, not dead. Same in test doubles.
# Sites: agent/agents/handlers/*.py, agent/tests/unit/test_handlers.py
retriever

# async/sync context-manager dunder signatures: __aexit__/__exit__ must accept
# (exc_type, exc_val, exc_tb) per the Python protocol; the body ignores exc_tb.
# Sites: clients/base.py, gateways/*.py, supabase/client_types.py,
#        services/cache.py, utils/logger.py
exc_tb

# No-op metrics interface mirroring OpenTelemetry Counter.add / Histogram.record;
# `amount` is part of the public signature even though the no-op ignores it.
# Site: agent/infrastructure/observability/metrics.py
amount

# Protocol method signatures (asyncpg abstraction): params declared on `...`
# stub methods so concrete impls and call sites type-check.
# Site: agent/infrastructure/supabase/client_types.py
command  # executemany(command, args)
min_size  # create_pool(dsn, *, min_size, max_size)

"""Vulture whitelist: framework / protocol signature params that look unused.

Each name below is a genuine framework or typing-contract hook, not dead code.
Vulture flags them as "unused variable" because the bodies are stubs or the
params are dispatched positionally, but removing them would break the contract.

This file is a vulture DSL artifact (bare names), not importable source. It is
NOT in the `make lint` scope (`ruff check agent/`); it lives at the agent root.

Run:  uv run vulture agent/ vulture_whitelist.py
Regenerate (then re-annotate):  uv run vulture agent/ --make-whitelist
"""

# async/sync context-manager dunder signatures: __aexit__/__exit__ must accept
# (exc_type, exc_val, exc_tb) per the Python protocol; the body ignores exc_tb.
# Sites: supabase/client_types.py, utils/logger.py
exc_tb

# No-op metrics interface mirroring OpenTelemetry Counter.add / Histogram.record;
# `amount` is part of the public signature even though the no-op ignores it.
# Site: agent/infrastructure/observability/metrics.py
amount

# pydantic `@field_validator` + `@classmethod` signature: `cls` is mandated by
# the decorator contract even when the validator body never touches it.
# Site: agent/clients/catalog_errors.py (_coerce_unknown)
cls

# Protocol method signatures (asyncpg abstraction): params declared on `...`
# stub methods so concrete impls and call sites type-check.
# Site: agent/infrastructure/supabase/client_types.py
command  # executemany(command, args)
min_size  # create_pool(dsn, *, min_size, max_size)

# pydantic-ai Model.request override signature: (messages, model_settings,
# model_request_parameters) is the abstract contract; failover test doubles
# that simulate a slow/failing provider ignore the parameters.
# Site: agent/tests/unit/test_model_failover.py
model_request_parameters

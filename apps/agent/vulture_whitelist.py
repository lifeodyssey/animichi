"""Vulture whitelist: framework / protocol signature params that look unused.

Each name below is a genuine framework or typing-contract hook, not dead code.
Vulture flags them as "unused variable" because the bodies are stubs or the
params are dispatched positionally, but removing them would break the contract.

This file is a vulture DSL artifact (bare names), not importable source. It is
NOT in the `make lint` scope (`ruff check src/animichi/`); it lives at the agent root.

Run:  uv run vulture src/animichi/ vulture_whitelist.py
Regenerate (then re-annotate):  uv run vulture src/animichi/ --make-whitelist
"""

# async/sync context-manager dunder signatures: __aexit__/__exit__ must accept
# (exc_type, exc_val, exc_tb) per the Python protocol; the body ignores exc_tb.
# Sites: utils/logger.py
exc_tb

# SQLAlchemy UserDefinedType.get_col_spec(**kw) override contract: SQLAlchemy
# dispatches column kwargs positionally; the PostGIS geography/geometry specs
# ignore them.
# Site: src/animichi/infrastructure/persistence/expressions.py
kw

# No-op metrics interface mirroring OpenTelemetry Counter.add / Histogram.record;
# `amount` is part of the public signature even though the no-op ignores it.
# Site: src/animichi/infrastructure/observability/metrics.py
amount

# pydantic `@field_validator` + `@classmethod` signature: `cls` is mandated by
# the decorator contract even when the validator body never touches it.
# Site: src/animichi/clients/catalog_errors.py (_coerce_unknown)
cls

# PlainDsnContainer Protocol mirrors testcontainers' real keyword signature;
# the parameter name must stay `driver` for structural typing.
driver

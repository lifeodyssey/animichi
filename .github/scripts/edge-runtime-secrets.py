#!/usr/bin/env python3
"""Validate and render the exact edge runtime-secret promotion payload."""

import json
import os
import sys
from pathlib import Path

import tomllib

CORE_NAMES = (
    "DEEPSEEK_API_KEY",
    "MIMO_API_KEY",
    "ZEN_GO_API_KEY",
    "SUPABASE_DB_URL",
    "GOOGLE_MAPS_API_KEY",
    "LOGFIRE_TOKEN",
)
ANON_NAMES = ("TURNSTILE_SECRET", "ANON_ID_SECRET")
ENVIRONMENTS = ("staging", "production")


def fail(message: str) -> None:
    raise SystemExit(f"edge runtime secrets: {message}")


def load_config(path: str):
    with Path(path).open("rb") as source:
        return tomllib.load(source)


def anon_flag(config, environment: str) -> str:
    try:
        return config["env"][environment]["vars"]["ANON_ACCESS_ENABLED"]
    except (KeyError, TypeError):
        fail(f"ANON_ACCESS_ENABLED is missing for {environment}")


def required_names(config, environment: str) -> tuple[str, ...]:
    flag = anon_flag(config, environment)
    if flag not in ("true", "false"):
        fail(f"ANON_ACCESS_ENABLED must be true or false for {environment}")
    return CORE_NAMES + ANON_NAMES if flag == "true" else CORE_NAMES


def values_for(names: tuple[str, ...]) -> dict[str, str]:
    missing = [name for name in names if not os.environ.get(name, "").strip()]
    if missing:
        fail(f"missing required values: {', '.join(missing)}")
    return {name: os.environ[name] for name in names}


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] not in ("preflight", "render"):
        fail("usage: edge-runtime-secrets.py <preflight|render> <environment> <config>")
    command, environment, path = sys.argv[1:]
    if environment not in ENVIRONMENTS:
        fail("environment must be staging or production")
    values = values_for(required_names(load_config(path), environment))
    if command == "render":
        print(json.dumps(values, separators=(",", ":")))
    else:
        print(f"edge runtime secrets ready for {environment}: {', '.join(values)}")


if __name__ == "__main__":
    main()

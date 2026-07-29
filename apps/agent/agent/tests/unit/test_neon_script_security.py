"""Secret-transport contract for the Neon test-base provisioner."""

from pathlib import Path


def _script() -> str:
    root = Path(__file__).resolve().parents[5]
    return (root / "scripts" / "neon-test-base.sh").read_text(encoding="utf-8")


def test_curl_authorization_header_comes_from_mode_0600_file() -> None:
    script = _script()
    assert '--header "@${AUTH_HEADER_FILE}"' in script
    assert 'chmod 600 "$AUTH_HEADER_FILE"' in script
    assert '--header "Authorization: Bearer ${NEON_API_KEY}"' not in script


def test_dsn_never_reaches_argv_through_an_env_prefix() -> None:
    """`env VAR=… cmd` execs env itself, so VAR=… lands in ps-visible argv.

    A bare `VAR=… cmd` prefix does not — bash puts it in the child's environ.
    Only the `env` form leaks, so that is what this forbids.
    """
    script = _script()
    assert "env PYTHONPATH" not in script
    assert 'env DATABASE_URL="$DATABASE_URL"' not in script
    assert "export PYTHONPATH=" in script


def test_psql_uses_non_secret_service_names_in_argv() -> None:
    script = _script()
    assert '"service=database"' in script
    assert '"service=maintenance"' in script
    assert 'psql -X --set=ON_ERROR_STOP=1 "$DATABASE_URL"' not in script
    assert 'psql -X --set=ON_ERROR_STOP=1 "$MAINTENANCE_URL"' not in script

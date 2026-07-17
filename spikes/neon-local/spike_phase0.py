#!/usr/bin/env python3
"""Phase-0 Neon Local validation runner; intentionally outside production code."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import math
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict, cast

import asyncpg

try:
    from testcontainers.core.generic import GenericContainer
except ImportError:
    from testcontainers.core.container import DockerContainer as GenericContainer

API_BASE = "https://console.neon.tech/api/v2"
IMAGE = "neondatabase/neon_local:latest"
ROOT = Path(__file__).resolve().parents[2]
FINDINGS = Path(os.environ.get("NEON_FINDINGS_PATH", Path(__file__).with_name("FINDINGS.md")))
PYTHON_ITEMS = (
    "GenericContainer start and readiness", "asyncpg self-signed TLS connection",
    "PostGIS, vector(1024), and HNSW", "N=20 query latency",
    "Upstream path session semantics", "SET LOCAL ROLE agent_svc",
    "Atlas revisions ledger discovery", "Ephemeral branch API identity and name",
    "Node serverless probe invocation", "Ephemeral branch deletion after container exit",
)

Branch = TypedDict("Branch", {"id": str, "name": str, "parent_id": str, "project_id": str}, total=False)

def sanitize(value: object) -> str:
    text = str(value).replace("\n", " ").replace("|", "/")
    text = re.sub(r"postgres(?:ql)?://[^\s]+", "<redacted-dsn>", text)
    key = os.environ.get("NEON_API_KEY", "")
    return text.replace(key, "<redacted-key>")[:300] if key else text[:300]

class Reporter:
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.seen: set[str] = set()
        self.failures = 0

    def record(self, item: str, passed: bool, evidence: object) -> None:
        status = "PASS" if passed else "FAIL"
        safe_evidence = sanitize(evidence)
        print(f"{status} {item}\n  evidence: {safe_evidence}", flush=True)
        stamp = datetime.now(UTC).isoformat(timespec="seconds")
        with FINDINGS.open("a", encoding="utf-8") as stream:
            stream.write(f"| {stamp} | {self.mode} | {item} | {status} | {safe_evidence} |\n")
        self.seen.add(item)
        self.failures += int(not passed)

    def finish_missing(self, blocker: object) -> None:
        for item in PYTHON_ITEMS:
            if item not in self.seen:
                self.record(item, False, f"not reached: {sanitize(blocker)}")

def required_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"missing required environment variable {name}")
    return value

def parent_branch_id() -> str:
    value = os.environ.get("NEON_TEST_BASE_BRANCH_ID") or os.environ.get("PARENT_BRANCH_ID")
    if not value:
        raise RuntimeError("missing NEON_TEST_BASE_BRANCH_ID (or PARENT_BRANCH_ID)")
    return value

def api_json(path: str, method: str = "GET") -> object | None:
    key = required_env("NEON_API_KEY")
    request = urllib.request.Request(f"{API_BASE}/{path}", method=method)
    request.add_header("Authorization", f"Bearer {key}")
    request.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f"Neon API returned HTTP {error.code}") from error

def list_branches(project_id: str) -> list[Branch]:
    payload = api_json(f"projects/{project_id}/branches?limit=100")
    if not isinstance(payload, dict) or not isinstance(payload.get("branches"), list):
        raise RuntimeError("Neon API branch list had an unexpected shape")
    return cast(list[Branch], [branch for branch in payload["branches"] if isinstance(branch, dict)])

def verify_parent(project_id: str, parent_id: str) -> None:
    payload = api_json(f"projects/{project_id}/branches/{parent_id}")
    branch = payload.get("branch") if isinstance(payload, dict) else None
    if not isinstance(branch, dict):
        raise RuntimeError("configured parent branch does not exist")
    if branch.get("project_id") != project_id or branch.get("name") != "test-base":
        raise RuntimeError("configured parent is not test-base in NEON_PROJECT_ID")

def wait_new_branch(project_id: str, parent_id: str, before: set[str]) -> Branch:
    for _ in range(30):
        candidates = [
            branch
            for branch in list_branches(project_id)
            if branch.get("id") not in before and branch.get("parent_id") == parent_id
        ]
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise RuntimeError("multiple new branches matched this parent; rerun without concurrent starts")
        time.sleep(2)
    raise RuntimeError("ephemeral branch was not observable through the API within 60 seconds")

def wait_deleted(project_id: str, branch_id: str) -> bool:
    for _ in range(30):
        if api_json(f"projects/{project_id}/branches/{branch_id}") is None:
            return True
        time.sleep(2)
    return False

def tls_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context

async def wait_ready(dsn: str) -> None:
    last_error: Exception | None = None
    for _ in range(60):
        try:
            connection = await asyncpg.connect(dsn, ssl=tls_context(), timeout=5, statement_cache_size=0)
            await connection.fetchval("SELECT 1")
            await connection.close()
            return
        except Exception as error:
            last_error = error
            await asyncio.sleep(2)
    raise RuntimeError(f"database readiness timed out: {sanitize(last_error)}")

def percentile(samples: list[float], fraction: float) -> float:
    ordered = sorted(samples)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]

async def database_checks(dsn: str, reporter: Reporter) -> None:
    started = time.perf_counter()
    try:
        connection = await asyncpg.connect(dsn, ssl=tls_context(), timeout=10, statement_cache_size=0)
    except Exception as error:
        reporter.record(PYTHON_ITEMS[1], False, error)
        return
    reporter.record(PYTHON_ITEMS[1], True, f"connected in {(time.perf_counter() - started) * 1000:.1f} ms")
    await connection.close()

    # ponytail: EMPIRICAL — the proxy recycles asyncpg connections at unpredictable
    # points (died after 48s in one run, after seconds in another). Every check group
    # therefore gets its own fresh connection, with one reconnect retry.
    async def run_isolated(check) -> None:
        for attempt in (1, 2):
            conn = await asyncpg.connect(dsn, ssl=tls_context(), timeout=10, statement_cache_size=0)
            try:
                await check(conn, reporter)
                return
            except (asyncpg.PostgresConnectionError, ConnectionError, OSError):
                if attempt == 2:
                    raise
            finally:
                with contextlib.suppress(Exception):
                    await conn.close()

    await run_isolated(extension_checks)
    await run_isolated(latency_checks)
    await run_isolated(session_checks)
    await run_isolated(role_check)
    await run_isolated(ledger_check)

async def extension_checks(connection: asyncpg.Connection, reporter: Reporter) -> None:
    version = await connection.fetchval("SELECT postgis_version()")
    vector_version = await connection.fetchval("SELECT extversion FROM pg_extension WHERE extname='vector'")
    distance = await connection.fetchval(
        "SELECT ST_Distance(ST_SetSRID(ST_MakePoint(139.7,35.6),4326)::geography,"
        " ST_SetSRID(ST_MakePoint(139.8,35.7),4326)::geography)"
    )
    await connection.execute("CREATE TEMP TABLE phase0_vector_probe (embedding vector(1024))")
    await connection.execute("INSERT INTO phase0_vector_probe VALUES ($1::vector)", "[" + ",".join(["0"] * 1024) + "]")
    dimensions = await connection.fetchval("SELECT vector_dims(embedding) FROM phase0_vector_probe")
    hnsw = await connection.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' "
        "AND tablename='points' AND indexdef ILIKE '%USING hnsw%')"
    )
    passed = bool(version and vector_version and distance and dimensions == 1024 and hnsw)
    reporter.record(PYTHON_ITEMS[2], passed, f"postgis={version}; vector={vector_version}; dims={dimensions}; hnsw={hnsw}")

async def latency_checks(connection: asyncpg.Connection, reporter: Reporter) -> None:
    samples: list[float] = []
    for _ in range(20):
        started = time.perf_counter()
        await connection.fetchval("SELECT 1")
        samples.append((time.perf_counter() - started) * 1000)
    p50, p95 = percentile(samples, 0.50), percentile(samples, 0.95)
    reporter.record(PYTHON_ITEMS[3], True, f"p50={p50:.2f} ms; p95={p95:.2f} ms; 59-query lower bound={p50 * 59:.0f} ms")

async def session_checks(connection: asyncpg.Connection, reporter: Reporter) -> None:
    pids = [await connection.fetchval("SELECT pg_backend_pid()") for _ in range(3)]
    statement = await connection.prepare("SELECT $1::int + 1")
    prepared = [await statement.fetchval(value) for value in (1, 2)]
    await connection.execute("SET phase0.session_probe = 'persisted'")
    setting = await connection.fetchval("SELECT current_setting('phase0.session_probe')")
    await connection.execute("RESET phase0.session_probe")
    passed = len(set(pids)) == 1 and prepared == [2, 3] and setting == "persisted"
    reporter.record(PYTHON_ITEMS[4], passed, f"pid_stable={len(set(pids)) == 1}; prepared_reuse={prepared}; session_SET={setting}")

async def role_check(connection: asyncpg.Connection, reporter: Reporter) -> None:
    membership = await connection.fetchval("SELECT pg_has_role(current_user, 'agent_svc', 'SET')")
    async with connection.transaction():
        await connection.execute("SET LOCAL ROLE agent_svc")
        current_role = await connection.fetchval("SELECT current_user")
    reporter.record(PYTHON_ITEMS[5], membership and current_role == "agent_svc", f"membership_SET={membership}; local_role={current_role}")

async def ledger_check(connection: asyncpg.Connection, reporter: Reporter) -> None:
    rows = await connection.fetch(
        "SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS relation "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind='r' AND (c.relname ILIKE '%atlas%' OR c.relname ILIKE '%revision%') "
        "ORDER BY 1"
    )
    names = [str(row["relation"]) for row in rows]
    reporter.record(PYTHON_ITEMS[6], bool(names), ", ".join(names) if names else "no Atlas revision relation found")

def run_node_probe(port: int, database: str, reporter: Reporter) -> None:
    environment = os.environ.copy()
    for secret in ("NEON_API_KEY", "TEST_DATABASE_URL"):
        environment.pop(secret, None)
    environment.update(NEON_LOCAL_PORT=str(port), NEON_LOCAL_DATABASE=database,
                       NEON_FINDINGS_PATH=str(FINDINGS), NEON_PHASE0_MODE=reporter.mode)
    script = Path(__file__).with_name("spike_phase0_serverless.mjs")
    result = subprocess.run(["node", str(script)], cwd=ROOT, env=environment, text=True, capture_output=True, check=False)
    if result.stdout:
        for line in result.stdout.splitlines():
            print(sanitize(line), flush=True)
    reporter.record(PYTHON_ITEMS[8], result.returncode == 0, "Node probe completed" if result.returncode == 0 else result.stderr)

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kill-test", action="store_true", help="use docker kill instead of clean stop")
    parser.add_argument("--skip-serverless", action="store_true", help="omit the Node probe")
    return parser.parse_args()

def main() -> int:
    args = parse_args()
    mode = "kill-test" if args.kill_test else "clean-stop"
    reporter = Reporter(mode)
    container = None
    branch_id = ""
    blocker: object = "runner ended before the item executed"
    try:
        api_key = required_env("NEON_API_KEY")
        project_id = required_env("NEON_PROJECT_ID")
        parent_id = parent_branch_id()
        database = os.environ.get("NEON_DATABASE_NAME", "neondb")
        verify_parent(project_id, parent_id)
        before = {str(branch["id"]) for branch in list_branches(project_id)}
        container = GenericContainer(IMAGE).with_exposed_ports(5432)
        container.with_env("NEON_API_KEY", api_key).with_env("NEON_PROJECT_ID", project_id)
        container.with_env("PARENT_BRANCH_ID", parent_id).with_env("DELETE_BRANCH", "true")
        started = time.perf_counter()
        container.start()
        port = int(container.get_exposed_port(5432))
        dsn = f"postgres://neon:npg@127.0.0.1:{port}/{database}?sslmode=require"
        asyncio.run(wait_ready(dsn))
        reporter.record(PYTHON_ITEMS[0], True, f"image={IMAGE}; host=127.0.0.1:{port}; ready_ms={(time.perf_counter() - started) * 1000:.0f}")
        branch = wait_new_branch(project_id, parent_id, before)
        branch_id = str(branch["id"])
        branch_name = str(branch.get("name", ""))
        identity_ok = branch.get("project_id") == project_id and branch.get("parent_id") == parent_id
        reporter.record(PYTHON_ITEMS[7], identity_ok, f"parent=test-base; ephemeral_name={branch_name}; branch_exists=true")
        asyncio.run(database_checks(dsn, reporter))
        if args.skip_serverless:
            reporter.record(PYTHON_ITEMS[8], True, "skipped by explicit --skip-serverless")
        else:
            run_node_probe(port, database, reporter)
    except Exception as error:
        blocker = error
    finally:
        if container is not None:
            try:
                if args.kill_test:
                    container_id = container.get_wrapped_container().id
                    subprocess.run(["docker", "kill", container_id], capture_output=True, check=True)
                    container.get_wrapped_container().remove(force=True, v=True)
                else:
                    container.get_wrapped_container().stop(timeout=20)
                    container.get_wrapped_container().remove(v=True)
                if branch_id:
                    deleted = wait_deleted(required_env("NEON_PROJECT_ID"), branch_id)
                    evidence = "API returned 404 after docker kill" if args.kill_test else "API returned 404 after clean stop"
                    reporter.record(PYTHON_ITEMS[9], deleted, evidence if deleted else "branch remained after 60 seconds; orphan cleanup required")
                    if not deleted:
                        api_json(f"projects/{required_env('NEON_PROJECT_ID')}/branches/{branch_id}", method="DELETE")
            except Exception as error:
                blocker = error
        reporter.finish_missing(blocker)
    return 1 if reporter.failures else 0

if __name__ == "__main__":
    sys.exit(main())

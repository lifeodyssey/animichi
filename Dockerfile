# Pinned to a patch tag, not the floating `3.11-slim` — #284 Task 1 raises the
# interpreter floor to >=3.11.10 (CPython gh-113171 fixed `ipaddress.is_global`
# classification for CGNAT/metadata ranges in 3.11.10/3.12.4). A floating minor
# tag could silently regress below that fix.
FROM public.ecr.aws/docker/library/python:3.11.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY apps/agent/pyproject.toml apps/agent/uv.lock /app/

# --no-build is safe only here: --no-install-project skips the local editable
# package (the one thing in this project with no wheel), so it doesn't hit
# the failure documented on the second `uv sync` below and in
# .github/workflows/purge-anonymous-sessions.yml's NOTE.
RUN uv sync --no-dev --no-install-project --frozen --no-build

COPY apps/agent/agent /app/agent

# --no-build rejected here: this `uv sync` installs the local editable
# project itself, which has no wheel ("marked as --no-build but has no
# binary distribution", verified locally) — same finding as the reusable
# Python CI workflows and purge-anonymous-sessions.yml.
RUN uv sync --no-dev --frozen

FROM public.ecr.aws/docker/library/python:3.11.13-slim

# APP_ENV is intentionally NOT defaulted here (issue #498 follow-up — 4th
# touchpoint alongside wrangler.toml's three [vars] blocks): the real deploy
# path (RuntimeContainer, see worker/containerEnv.ts) always injects it, and
# a hardcoded "production" default here would silently claim production for
# anyone who `docker run`s this image directly, bypassing the Worker's
# fail-closed CONTAINER_REQUIRED_KEYS check entirely. Settings.app_env's own
# Field default ("development") applies when APP_ENV is unset — the same
# least-privileged-by-default convention as wrangler.toml's own [vars] block.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    SERVICE_HOST=0.0.0.0 \
    SERVICE_PORT=8080

WORKDIR /app

COPY --from=builder /app /app

RUN useradd -r -s /bin/false appuser

# #494: build-time git metadata. The CI deploy path builds this image through
# `wrangler deploy` (wrangler.toml [[containers]] image = "./Dockerfile"), which
# cannot pass `--build-arg` (workers-sdk #12991) — CI instead bakes
# apps/agent/agent/build_info.py before deploying, and the existing COPY of
# that directory ships it into /app/agent. These ARG/ENV pairs cover manual
# `docker build --build-arg GIT_COMMIT=... GIT_BRANCH=...` builds; empty
# defaults keep a plain build healthy (health.py falls through to git).
ARG GIT_COMMIT=""
ARG GIT_BRANCH=""
ENV GIT_COMMIT=${GIT_COMMIT} \
    GIT_BRANCH=${GIT_BRANCH}
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SERVICE_PORT\", \"8080\")}/healthz', timeout=3)"

CMD ["python", "-m", "agent.interfaces.fastapi_service"]

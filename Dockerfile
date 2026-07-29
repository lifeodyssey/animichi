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

RUN uv sync --no-dev --no-install-project

COPY apps/agent/agent /app/agent

RUN uv sync --no-dev

FROM public.ecr.aws/docker/library/python:3.11.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    APP_ENV=production \
    SERVICE_HOST=0.0.0.0 \
    SERVICE_PORT=8080

WORKDIR /app

COPY --from=builder /app /app

RUN useradd -r -s /bin/false appuser
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SERVICE_PORT\", \"8080\")}/healthz', timeout=3)"

CMD ["python", "-m", "agent.interfaces.fastapi_service"]

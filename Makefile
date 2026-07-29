# Animichi Agent - Makefile

.PHONY: help install dev dev-db dev-local serve test test-all test-cov test-integration test-eval test-eval-fullstack lint format typecheck check clean build db-diff db-list db-pull db-push db-push-dry db-reset fe-lint fe-typecheck fe-test fe-test-cov fe-build fe-check check-all e2e-setup e2e e2e-public local-login dev-stop

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR
ATLAS_VERSION ?= 0.30.0
export ATLAS_VERSION
PYTHON ?= .venv/bin/python
PYTEST ?= $(PYTHON) -m pytest

help:
	@echo "Animichi Agent - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev-db      Start agent-only Neon Local on postgres-wire port 5432"
	@echo "  make dev-local   Start everything (Supabase + backend + frontend)"
	@echo "  make dev-stop    Stop all local dev services"
	@echo "  make local-login Open browser with magic link login"
	@echo "  make install     Install production dependencies"
	@echo "  make dev         Install all dependencies (including dev)"
	@echo "  make serve       Run the HTTP runtime service only"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Run unit tests"
	@echo "  make test-all    Run stable automated tests (unit + integration)"
	@echo "  make test-cov    Run tests with coverage report"
	@echo "  make test-eval   Run model-backed evals"
	@echo "  make test-eval-fullstack  Run thin full-stack eval (opt-in, not a PR gate)"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        Run linters (ruff)"
	@echo "  make format      Format code (ruff)"
	@echo "  make typecheck   Run mypy type checker"
	@echo "  make check       Run all checks (lint + typecheck + test)"
	@echo ""
	@echo "Database:"
	@echo "  make db-list     Show Supabase migration status"
	@echo "  make db-push-dry  Dry-run Supabase migrations"
	@echo "  make db-push     Apply Supabase migrations"
	@echo ""
	@echo "E2E Testing:"
	@echo "  make e2e-setup   Start Supabase + Edge Function + seed data"
	@echo "  make e2e         Run all Playwright E2E tests"
	@echo "  make e2e-public  Run E2E tests that don't need email"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean       Remove build artifacts and caches"

install:
	cd apps/agent && uv sync --no-dev

dev:
	cd apps/agent && uv sync --extra dev

serve:
	cd apps/agent && uv run animichi-api

test:
	cd apps/agent && $(PYTEST) agent/tests/unit/ -v

test-all:
	cd apps/agent && $(PYTEST) agent/tests/unit agent/tests/integration -v

test-cov:
	cd apps/agent && $(PYTEST) agent/tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	cd apps/agent && $(PYTEST) agent/tests/integration/ -v --no-cov

test-eval:
	cd apps/agent && $(PYTHON) -m agent.tests.eval.run_agent_eval
	cd apps/agent && $(PYTEST) agent/tests/eval/test_translation.py -v -m integration --no-cov

test-eval-fullstack:
	cd apps/agent && EVAL_FULLSTACK=1 EVAL_MAX_CASES=$${EVAL_MAX_CASES:-50} $(PYTHON) -m agent.tests.eval.run_agent_eval

lint:
	cd apps/agent && uv run ruff check agent/ scripts/
	cd apps/agent && uv run ruff format --check agent/ scripts/

format:
	cd apps/agent && uv run ruff format agent/ scripts/
	cd apps/agent && uv run ruff check --fix agent/ scripts/

typecheck:
	cd apps/agent && uv run mypy agent/agents/ agent/interfaces/ agent/domain/ agent/infrastructure/ agent/clients/ agent/tests/eval/ agent/scripts/purge_anonymous_sessions.py

check: lint typecheck test test-integration

# ── Frontend ──────────────────────────────────────────────────

fe-lint:
	cd frontend && npx eslint .

fe-typecheck:
	cd frontend && npx tsc --noEmit

fe-test:
	cd frontend && npx vitest run

fe-test-cov:
	cd frontend && npx vitest run --coverage

fe-build:
	cd frontend && npm run build

fe-check: fe-lint fe-typecheck fe-test

# ── Full check (backend + frontend) ──────────────────────────

check-all: check fe-check

clean:
	rm -rf __pycache__ .pytest_cache .coverage htmlcov coverage.xml
	rm -rf .ruff_cache .mypy_cache
	rm -rf dist build *.egg-info
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

build:
	cd apps/agent && uv build

db-diff:
	supabase db diff -f $(NAME) --schema public

db-list:
	supabase migration list --db-url $$SUPABASE_DB_URL

db-pull:
	supabase db pull $(NAME) --schema public

db-push-dry:
	supabase db push --dry-run --db-url $$SUPABASE_DB_URL

db-push:
	supabase db push --db-url $$SUPABASE_DB_URL

db-reset:
	supabase db reset

# ── Local Dev (one-command startup) ──────────────────────────

# Set NEON_DEV_BRANCH_ID for persistent mode. Leave it unset and set the
# verified NEON_TEST_BASE_BRANCH_ID for an ephemeral child deleted on stop.
dev-db:
	@: "$${NEON_API_KEY:?NEON_API_KEY is required}"
	@: "$${NEON_PROJECT_ID:?NEON_PROJECT_ID is required}"
	@branch_env="PARENT_BRANCH_ID=$${NEON_TEST_BASE_BRANCH_ID:-}"; delete_branch=true; \
	if [ -n "$${NEON_DEV_BRANCH_ID:-}" ]; then \
		branch_env="BRANCH_ID=$$NEON_DEV_BRANCH_ID"; delete_branch=false; \
	fi; \
	if [ -z "$${branch_env#*=}" ]; then \
		echo "Set NEON_TEST_BASE_BRANCH_ID, or NEON_DEV_BRANCH_ID for persistent mode" >&2; \
		exit 1; \
	fi; \
	echo "Agent DSN: postgresql://neon:npg@localhost:5432/neondb?sslmode=require"; \
	docker run --rm --name animichi-neon-local -p 5432:5432 \
		-e NEON_API_KEY -e NEON_PROJECT_ID -e "$$branch_env" \
		-e DELETE_BRANCH="$$delete_branch" neondatabase/neon_local:latest

dev-local:
	@echo "=== Animichi Local Dev ==="
	@# 0. Kill stale processes from previous runs
	@-lsof -ti :8080 | xargs kill 2>/dev/null; true
	@-lsof -ti :3001 | xargs kill 2>/dev/null; true
	@# 1. Verify Supabase is running (start if not)
	@supabase status 2>&1 | grep -q "running" || (echo "Starting Supabase..." && supabase start --exclude vector,analytics --ignore-health-check)
	@# 2. Wait for DB to be ready
	@echo "Waiting for database..."
	@for i in $$(seq 1 30); do docker exec supabase_db_seichijunrei-agent psql -U postgres -c "SELECT 1" >/dev/null 2>&1 && break || sleep 1; done
	@echo "✓ Database ready"
	@# 3. Seed data if bangumi table is empty
	@COUNT=$$(docker exec supabase_db_seichijunrei-agent psql -U postgres -d postgres -tAc "SELECT count(*) FROM bangumi" 2>/dev/null || echo "0"); \
	if [ "$$COUNT" = "0" ]; then \
		docker exec -i supabase_db_seichijunrei-agent psql -U postgres -d postgres < apps/agent/agent/tests/fixtures/seed.sql; \
		echo "✓ Seed data applied"; \
	else \
		echo "✓ Data exists ($$COUNT bangumi)"; \
	fi
	@# 4. Start Edge Function for auth emails (with local SITE_URL)
	@supabase functions serve send-auth-email --no-verify-jwt --env-file supabase/.env.local > /tmp/animichi-edge.log 2>&1 & echo $$! > /tmp/animichi-edge.pid
	@echo "✓ Edge Function started (SITE_URL=http://localhost:3001)"
	@# 5. Start backend with .env (background, daemonized)
	@env $$(grep -v '^\#' .env | grep -v '^$$' | xargs) bash -c 'cd apps/agent && uv run uvicorn agent.interfaces.fastapi_service:app --host 0.0.0.0 --port 8080' > /tmp/animichi-backend.log 2>&1 & echo $$! > /tmp/animichi-backend.pid
	@# 6. Wait for backend health
	@echo "Waiting for backend..."
	@for i in $$(seq 1 60); do curl -s http://localhost:8080/healthz >/dev/null 2>&1 && break || sleep 2; done
	@curl -s http://localhost:8080/healthz >/dev/null 2>&1 && echo "✓ Backend ready on :8080" || (echo "✗ Backend failed — check /tmp/animichi-backend.log" && exit 1)
	@# 7. Start frontend on :3001 (matching config.toml site_url)
	@cd frontend && npm run dev > /tmp/animichi-frontend.log 2>&1 & echo $$! > /tmp/animichi-frontend.pid
	@sleep 3
	@echo "✓ Frontend starting on :3001"
	@echo ""
	@echo "=== Ready ==="
	@echo "  Frontend:  http://localhost:3001"
	@echo "  Backend:   http://localhost:8080/healthz"
	@echo "  Mailpit:   http://localhost:54324"
	@echo "  Studio:    http://localhost:54323"
	@echo "  Login:     make local-login"
	@echo "  Stop:      make dev-stop"

dev-stop:
	@echo "Stopping local dev services..."
	@-test -f /tmp/animichi-edge.pid && kill $$(cat /tmp/animichi-edge.pid) 2>/dev/null && rm /tmp/animichi-edge.pid && echo "✓ Edge Function stopped" || true
	@-test -f /tmp/animichi-backend.pid && kill $$(cat /tmp/animichi-backend.pid) 2>/dev/null && rm /tmp/animichi-backend.pid && echo "✓ Backend stopped" || true
	@-test -f /tmp/animichi-frontend.pid && kill $$(cat /tmp/animichi-frontend.pid) 2>/dev/null && rm /tmp/animichi-frontend.pid && echo "✓ Frontend stopped" || true
	@-lsof -ti :8080 | xargs kill 2>/dev/null; true
	@-lsof -ti :3001 | xargs kill 2>/dev/null; true
	@echo "Done. (Supabase still running — use 'supabase stop' to shut down)"

# ── E2E Testing ──────────────────────────────────────────────

e2e-setup:
	bash scripts/e2e-setup.sh

e2e:
	cd e2e && npx playwright test

e2e-public:
	cd e2e && npx playwright test public-pages.spec.ts middleware-redirect.spec.ts login-modal.spec.ts

local-login:
	bash scripts/local-login.sh

# ── Setup ────────────────────────────────────────────────────

setup: dev
	@echo ""
	@echo "Setup complete! Try: make test"

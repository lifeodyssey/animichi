# Seichijunrei Agent - Makefile

.PHONY: help install dev dev-local serve test test-all test-cov test-integration test-eval lint format typecheck check clean build db-diff db-list db-pull db-push db-push-dry db-reset fe-lint fe-typecheck fe-test fe-test-cov fe-build fe-check check-all e2e-setup e2e e2e-public local-login dev-stop

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR
PYTHON ?= .venv/bin/python
PYTEST ?= $(PYTHON) -m pytest

help:
	@echo "Seichijunrei Agent - Available commands:"
	@echo ""
	@echo "Development:"
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
	uv sync --no-dev

dev:
	uv sync --extra dev

serve:
	uv run seichijunrei-api

test:
	$(PYTEST) backend/tests/unit/ -v

test-all:
	$(PYTEST) backend/tests/unit backend/tests/integration -v

test-cov:
	$(PYTEST) backend/tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	$(PYTEST) backend/tests/integration/ -v --no-cov

test-eval:
	$(PYTEST) backend/tests/eval/test_agent_eval.py backend/tests/eval/test_translation.py -v -m integration --no-cov

lint:
	uv run ruff check backend/
	uv run ruff format --check backend/

format:
	uv run ruff format backend/
	uv run ruff check --fix backend/

typecheck:
	uv run mypy backend/agents/ backend/interfaces/ backend/domain/ backend/infrastructure/ backend/clients/

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
	uv build

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

dev-local:
	@echo "=== Seichijunrei Local Dev ==="
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
		docker exec -i supabase_db_seichijunrei-agent psql -U postgres -d postgres < backend/tests/fixtures/seed.sql; \
		echo "✓ Seed data applied"; \
	else \
		echo "✓ Data exists ($$COUNT bangumi)"; \
	fi
	@# 4. Start Edge Function for auth emails (with local SITE_URL)
	@supabase functions serve send-auth-email --no-verify-jwt --env-file supabase/.env.local > /tmp/seichijunrei-edge.log 2>&1 & echo $$! > /tmp/seichijunrei-edge.pid
	@echo "✓ Edge Function started (SITE_URL=http://localhost:3001)"
	@# 5. Start backend with .env (background, daemonized)
	@env $$(grep -v '^\#' .env | grep -v '^$$' | xargs) uv run uvicorn backend.interfaces.fastapi_service:app --host 0.0.0.0 --port 8080 > /tmp/seichijunrei-backend.log 2>&1 & echo $$! > /tmp/seichijunrei-backend.pid
	@# 6. Wait for backend health
	@echo "Waiting for backend..."
	@for i in $$(seq 1 60); do curl -s http://localhost:8080/healthz >/dev/null 2>&1 && break || sleep 2; done
	@curl -s http://localhost:8080/healthz >/dev/null 2>&1 && echo "✓ Backend ready on :8080" || (echo "✗ Backend failed — check /tmp/seichijunrei-backend.log" && exit 1)
	@# 7. Start frontend on :3001 (matching config.toml site_url)
	@cd frontend && npm run dev > /tmp/seichijunrei-frontend.log 2>&1 & echo $$! > /tmp/seichijunrei-frontend.pid
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
	@-test -f /tmp/seichijunrei-edge.pid && kill $$(cat /tmp/seichijunrei-edge.pid) 2>/dev/null && rm /tmp/seichijunrei-edge.pid && echo "✓ Edge Function stopped" || true
	@-test -f /tmp/seichijunrei-backend.pid && kill $$(cat /tmp/seichijunrei-backend.pid) 2>/dev/null && rm /tmp/seichijunrei-backend.pid && echo "✓ Backend stopped" || true
	@-test -f /tmp/seichijunrei-frontend.pid && kill $$(cat /tmp/seichijunrei-frontend.pid) 2>/dev/null && rm /tmp/seichijunrei-frontend.pid && echo "✓ Frontend stopped" || true
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

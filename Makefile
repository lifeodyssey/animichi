# Animichi - Makefile

.PHONY: help dev-local check-full db-new db-list db-hash db-lint db-validate db-push db-push-dry seed-gazetteer test-worker e2e-setup e2e local-login dev-stop visual-canonicalize visual-check visual-check-self-test

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR
ATLAS_VERSION ?= 0.30.0
export ATLAS_VERSION

# `:=` so no environment variable can move the binary the sanctioned lint command installs;
# CI runs that command rather than pinning its own copy.
SQLFLUFF_VERSION := 4.2.2

help:
	@echo "Animichi - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev-local   Start the web app"
	@echo "  make dev-stop    Stop all local dev services"
	@echo "  make local-login Open the Neon Auth magic link in your browser (AUTH-2 #950)"
	@echo ""
	@echo "Code Quality:"
	@echo "  make check-full  Every package + the Docker suites (manual; not a hook)"
	@echo ""
	@echo "Database:"
	@echo "  make db-new NAME=x  Create a timestamped Atlas migration"
	@echo "  make db-list        List checked-in Atlas migrations"
	@echo "  make db-hash        Regenerate migrations/neon/atlas.sum"
	@echo "  make db-lint        Lint migrations/neon (the command CI runs)"
	@echo "  make db-validate    Validate Atlas checksums and SQL"
	@echo "  make db-push-dry    Dry-run Atlas migrations against Neon"
	@echo "  make db-push        Apply Atlas migrations against Neon"
	@echo "  make seed-gazetteer Load gazetteer seed (needs DATABASE_URL; schema first)"
	@echo "  db-diff/db-pull/db-reset are retired; use the Atlas targets above"
	@echo ""
	@echo "E2E Testing:"
	@echo "  make e2e-setup   Install E2E deps + Playwright browser (no Supabase; auth E2E is Neon, AUTH-2 #950)"
	@echo "  make e2e         Run all Playwright E2E tests"
	@echo "  make visual-check  Pixel mockup comparison (PAGE=landing MODE=day RATIO=0.01; no PAGE = all frames; JSON -> e2e/visual/report/summary.json)"
	@echo "  make visual-check-self-test  Atom contract check (all frames; needs docker + app up)"
	@echo ""

# The manual everything-run. pre-push only gates what the branch changed
# (scripts/local-gates/pre-push-affected.sh), so this is where the whole
# workspace and the Docker-backed suites live: every package's own scripts, the
# disposable fresh-schema apply. Nothing here is a hook — run it before a large
# refactor lands, or when a lockfile change makes "affected" mean everything.
#
# The two suite segments run one package at a time. pnpm's default is one job
# per CPU, and several suites claim a fixed resource: a package's
# test:integration boots test-postgres (catalog's `test` was a second claimant
# until #1473 took the database suite out of `test`; #1726 named the script
# `test:integration`, which check-full runs). Run in parallel they
# starve each other -- measured 2026-09-08, nine browser specs failing with
# ERR_CONNECTION_REFUSED while the same suite passes 43/43 on its own. The
# browser suite is no longer one of the claimants: since #1692 it derives the
# port for its own checkout rather than sharing :8799 (`E2E_EMITTED_WORKER_PORT`
# pins it; e2e/AGENTS.md), so a second worktree is a second port and not this
# one. Serial is slower and true.
check-full:
	pnpm -r run --if-present lint
	pnpm -r run --if-present typecheck
	pnpm -r --workspace-concurrency=1 run --if-present test
	pnpm -r --workspace-concurrency=1 run --if-present test:integration
	bash scripts/local-gates/db-fresh-schema.sh

# ── Edge worker ───────────────────────────────────────────────

test-worker:
	pnpm run test:worker

ATLAS_MIGRATIONS := file://migrations/neon

db-new:
	@test -n "$(NAME)" || (echo "NAME is required (for example: make db-new NAME=add_routes_index)" >&2; exit 1)
	atlas migrate new "$(NAME)" --dir $(ATLAS_MIGRATIONS)

db-list:
	atlas migrate ls --dir $(ATLAS_MIGRATIONS)

db-hash:
	atlas migrate hash --dir $(ATLAS_MIGRATIONS)

# The one migration lint command, and the one CI's security job runs. `--config` is explicit
# because sqlfluff discovers `db/.sqlfluff` only for targets under `db/`; `env -u UV_CACHE_DIR`
# keeps the cache export at the top of this file out of a job that never had it.
db-lint:
	env -u UV_CACHE_DIR uvx --no-build "sqlfluff==$(SQLFLUFF_VERSION)" lint migrations/neon --config db/.sqlfluff

db-validate:
	atlas migrate validate --dir $(ATLAS_MIGRATIONS)

db-push-dry:
	@: "$${NEON_DATABASE_URL:?NEON_DATABASE_URL is required}"
	atlas migrate apply --dry-run --dir $(ATLAS_MIGRATIONS) --url "$${NEON_DATABASE_URL}" --revisions-schema public

db-push:
	@: "$${NEON_DATABASE_URL:?NEON_DATABASE_URL is required}"
	atlas migrate apply --dir $(ATLAS_MIGRATIONS) --url "$${NEON_DATABASE_URL}" --revisions-schema public

seed-gazetteer:
	@: "$${DATABASE_URL:?DATABASE_URL is required}"
	scripts/seed-gazetteer.sh

# ── Local Dev (one-command startup) ──────────────────────────

dev-local:
	@echo "=== Animichi Local Dev ==="
	@-lsof -ti :3000 | xargs kill 2>/dev/null; true
	@# The web app on :3000 (matching config.toml site_url). Login is Neon Auth
	@# (AUTH-2 #950); most of the Playwright suite stubs every transport, except
	@# e2e/web-neon-login.spec.ts, which drives the real Neon Auth origin.
	@pnpm --filter web dev > /tmp/animichi-web.log 2>&1 & echo $$! > /tmp/animichi-web.pid
	@sleep 3
	@echo "✓ Web app starting on :3000"
	@echo ""
	@echo "=== Ready ==="
	@echo "  Web app:   http://localhost:3000"
	@echo "  Login:     make local-login   (Neon Auth magic link; needs VITE_NEON_AUTH_BASE_URL + NEON_DATABASE_URL)"
	@echo "  Stop:      make dev-stop"

dev-stop:
	@echo "Stopping local dev services..."
	@-test -f /tmp/animichi-web.pid && kill $$(cat /tmp/animichi-web.pid) 2>/dev/null && rm /tmp/animichi-web.pid && echo "✓ Web app stopped" || true
	@-lsof -ti :3000 | xargs kill 2>/dev/null; true
	@echo "Done."

# ── E2E Testing ──────────────────────────────────────────────

e2e-setup:
	bash scripts/e2e-setup.sh

e2e:
	cd e2e && npx playwright test

local-login:
	bash scripts/local-login.sh

# ── Visual comparison (S0-v2 C3 + F2 task atom) ─────────────
# User-facing params: PAGE (frame key or partial key; empty = all frames),
# MODE (day|night), RATIO (pixel budget, from config — default 0.01).
# Result contract: e2e/visual/report/summary.json is the single authoritative
# verdict — exitCode 0 pass / 1 visual diff / 2 environment or invocation,
# plus per-frame ratio/pass and failedFrames. Through make, GNU make remaps
# any recipe failure to its own exit 2 (still nonzero); read summary.json to
# distinguish 1 from 2. Canonicalize runs inside scripts/visual-check.sh; the
# runner clears report/ once before the frame loop (never the host shell —
# bind-mount races; never per frame, or frame N+1 deletes frame N's report).

PAGE ?=
MODE ?= day
RATIO ?= 0.01
VISUAL_PLAYWRIGHT_IMAGE ?= mcr.microsoft.com/playwright:v1.62.0-noble

visual-canonicalize:
	@echo "visual-canonicalize: regenerating frozen canonical mockups"
	node --experimental-strip-types e2e/visual/canonicalize-cli.ts --out e2e/visual/canonical --fonts apps/web/src/styles/fonts.css

visual-check:
	@PAGE="$(PAGE)" MODE="$(MODE)" RATIO="$(RATIO)" \
	 VISUAL_PLAYWRIGHT_IMAGE="$(VISUAL_PLAYWRIGHT_IMAGE)" E2E_WEB_BASE_URL="$(E2E_WEB_BASE_URL)" \
	 bash scripts/visual-check.sh; exit $$?

# Self-test of the atom contract at the shell boundary: runs the atom WITHOUT
# PAGE (every frame), then asserts every frame has a report, every verdict is
# pass, and summary.exitCode is 0. The budget is loose by design (0.9999) —
# this checks the contract, not frame convergence (C4). Needs a reachable app
# (E2E_WEB_BASE_URL) and docker; fails closed when either is missing.
visual-check-self-test:
	@E2E_WEB_BASE_URL="$(E2E_WEB_BASE_URL)" bash e2e/visual/check-multiframe.sh
